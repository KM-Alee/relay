// LIVE security probe (T-161; Q2, Q3, F1.5, F1.6, F1.4, rubric criteria 1 + 9).
//
//   pnpm probe:security [baseUrl]          (default http://localhost:$PORT, PORT from apps/web/.env.local or 3000)
//   flags: --json  print the machine-readable result list at the end
//
// It talks to a RUNNING app over real HTTP with cookie jars + CSRF, like a browser or an attacker would:
//   1. logs in as Sunrise Owner, Sunrise plain User, Crescent Owner (seed users via /api/dev/login-as when the
//      dev tools are on, else POST /api/v1/auth/login with PROBE_<ROLE>_EMAIL / PROBE_<ROLE>_PASSWORD)
//   2. enumerates every /api/v1 route from the filesystem and checks unauthenticated, cross-workspace (404),
//      out-of-permission (403/404) and in-workspace record scope
//   3. masking: no raw opportunity/payment amounts for a user without crm.opportunity.value.view
//   4. CSRF: every unsafe method without the token / with a foreign Origin is refused
//   5. XSS payloads stored as text and rendered escaped (SSR HTML, plus a real Chromium DOM when available)
//   6. secrets: client bundle, every response seen during the run, and `git grep`
// Prints a rubric-style table; exits 1 when any check FAILS. It never prints secret values.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = join(ROOT, 'apps/web/.env.local');
// Loads the env into THIS process only (so we can look for secret VALUES in output); values are never printed.
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WANT_JSON = process.argv.includes('--json');
const BASE = (args[0] ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '');
const BASE_ORIGIN = new URL(BASE).origin;
const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(new URL(BASE).hostname);
const EVIL_ORIGIN = 'https://evil.example';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
interface Result {
  area: string;
  id: string;
  status: Status;
  detail: string;
}
const results: Result[] = [];
function record(area: string, id: string, status: Status, detail = '') {
  results.push({ area, id, status, detail });
}
const check = (area: string, id: string, ok: boolean, detail = '') =>
  record(area, id, ok ? 'PASS' : 'FAIL', detail);

// ── HTTP client with a cookie jar ───────────────────────────────────────
const SEEN: { where: string; body: string }[] = [];
const MAX_SEEN = 2_000_000;
let seenBytes = 0;
function remember(where: string, body: string) {
  if (seenBytes > MAX_SEEN * 20) return;
  seenBytes += body.length;
  SEEN.push({ where, body });
}

interface ReqOpts {
  body?: unknown;
  rawBody?: string;
  noCsrf?: boolean; // omit the x-csrf-token header (the cookie is still sent)
  csrfToken?: string; // override the header value
  origin?: string | null; // override Origin (null = omit)
  anonymous?: boolean; // do not send cookies at all
  headers?: Record<string, string>;
}
interface Resp {
  status: number;
  json: J;
  text: string;
  headers: Headers;
  setCookies: string[];
}

class Client {
  jar = new Map<string, string>();
  constructor(readonly name: string) {}
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc) || v === '') this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  csrf() {
    return this.jar.get('csrf');
  }
  async ensureCsrf() {
    if (!this.csrf()) await this.req('GET', '/api/v1/csrf');
  }
  async req(method: string, path: string, o: ReqOpts = {}): Promise<Resp> {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (!o.anonymous) {
      const c = this.cookieHeader();
      if (c) headers.cookie = c;
    }
    if (unsafe) {
      const tok = o.csrfToken ?? (o.noCsrf ? undefined : this.csrf());
      if (tok) headers['x-csrf-token'] = tok;
      if (o.origin !== null) headers.origin = o.origin ?? BASE_ORIGIN;
      if (o.body !== undefined || o.rawBody !== undefined) headers['content-type'] = 'application/json';
    }
    const res = await fetch(BASE + path, {
      method,
      headers,
      redirect: 'manual',
      body: o.rawBody ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
      signal: AbortSignal.timeout(60_000),
    });
    if (!o.anonymous) this.absorb(res);
    const text = await res.text();
    remember(`${this.name} ${method} ${path} -> ${res.status}`, text);
    let json: J = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html / csv */
    }
    return { status: res.status, json, text, headers: res.headers, setCookies: res.headers.getSetCookie() };
  }
  get = (p: string, o?: ReqOpts) => this.req('GET', p, o);
  post = (p: string, body?: unknown, o: ReqOpts = {}) => this.req('POST', p, { ...o, body });
  patch = (p: string, body?: unknown, o: ReqOpts = {}) => this.req('PATCH', p, { ...o, body });
  del = (p: string, o?: ReqOpts) => this.req('DELETE', p, o);
}

// ── Login ───────────────────────────────────────────────────────────────
const DEFAULT_PASSWORD = 'relay-dev-password'; // documented seed password; only ever used against localhost
interface Persona {
  key: string;
  label: string;
  email: string;
  client: Client;
  me?: J;
  ok: boolean;
  why?: string;
}
async function login(p: Persona, seedUsers: J[] | null): Promise<void> {
  await p.client.ensureCsrf();
  const seed = seedUsers?.find((u) => u.email === p.email);
  if (seed) {
    const r = await p.client.post('/api/dev/login-as', { userId: seed.userId });
    if (r.status === 200) {
      p.me = r.json;
      p.ok = true;
      checkCookieFlags(p, r);
      return;
    }
  }
  const envKey = `PROBE_${p.key}`;
  const email = process.env[`${envKey}_EMAIL`] ?? p.email;
  const password = process.env[`${envKey}_PASSWORD`] ?? (IS_LOCAL ? DEFAULT_PASSWORD : undefined);
  if (!password) return;
  const r = await p.client.post('/api/v1/auth/login', { email, password });
  p.why = `login ${r.status}${r.status === 429 ? ' (rate limited: 5 logins / email / 15 min; wait or use the dev-tools login)' : ''}`;
  if (r.status === 200) {
    p.me = r.json;
    p.ok = true;
    checkCookieFlags(p, r);
  }
}
let cookieFlagsChecked = false;
function checkCookieFlags(p: Persona, r: Resp) {
  if (cookieFlagsChecked) return;
  cookieFlagsChecked = true;
  const sid = r.setCookies.find((c) => /^(__Host-)?sid=/.test(c));
  if (!sid) return record('F1.6 session', 'session cookie set on login', 'FAIL', 'no sid Set-Cookie');
  const https = BASE.startsWith('https');
  const okFlags =
    /httponly/i.test(sid) && /samesite=(lax|strict)/i.test(sid) && (!https || /secure/i.test(sid));
  check(
    'F1.6 session',
    'sid cookie is HttpOnly + SameSite (+ Secure on https)',
    okFlags,
    okFlags ? '' : sid.replace(/=[^;]+/, '=<redacted>'),
  );
}

// ── Route enumeration ───────────────────────────────────────────────────
interface RouteMethod {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  permission: string | null;
  isPublic: boolean;
}
interface RouteDef {
  file: string;
  pattern: string; // /api/v1/contacts/[id]
  params: string[];
  methods: RouteMethod[];
}
function walk(dir: string, name: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, name, out);
    else if (e === name) out.push(p);
  }
  return out;
}
function enumerateRoutes(): RouteDef[] {
  const apiRoot = join(ROOT, 'apps/web/app/api/v1');
  const defs: RouteDef[] = [];
  for (const file of walk(apiRoot, 'route.ts').sort()) {
    const src = readFileSync(file, 'utf8');
    const rel = '/api/v1/' + relative(apiRoot, join(file, '..')).split(sep).join('/');
    const pattern = rel.replace(/\/$/, '');
    const marks: { method: RouteMethod['method']; at: number }[] = [];
    const re = /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    for (let m; (m = re.exec(src));) marks.push({ method: m[1] as RouteMethod['method'], at: m.index });
    const methods = marks.map((mk, i) => {
      const block = src.slice(mk.at, marks[i + 1]?.at ?? src.length);
      return {
        method: mk.method,
        permission: /permission:\s*'([^']+)'/.exec(block)?.[1] ?? null,
        isPublic: /auth:\s*'public'/.test(block),
      };
    });
    defs.push({
      file: relative(ROOT, file),
      pattern,
      params: [...pattern.matchAll(/\[(\w+)\]/g)].map((x) => x[1] as string),
      methods,
    });
  }
  return defs;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '0192f3a0-dead-7000-8000-00000000dead';
/** First array of {id} objects anywhere in the top two levels of a JSON response. */
function firstItems(j: J): J[] {
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') for (const v of Object.values(j)) if (Array.isArray(v)) return v;
  return [];
}
function allIds(j: J): string[] {
  return firstItems(j)
    .map((x) => x?.id)
    .filter((x): x is string => typeof x === 'string');
}

/** Expected-public /api/v1 endpoints. Any other `auth: 'public'` route is reported. */
const EXPECTED_PUBLIC = new Set([
  '/api/v1/csrf',
  '/api/v1/auth/login',
  '/api/v1/auth/signup',
  '/api/v1/auth/logout',
  '/api/v1/invites/preview',
  '/api/v1/invites/accept',
]);

/** Fill route params with real ids of workspace A (null when no fixture exists). */
async function resolvePath(
  pattern: string,
  owner: Client,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const segs = pattern.split('/');
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] ?? '';
    const m = /^\[(\w+)\]$/.exec(seg);
    if (!m) {
      out.push(seg);
      continue;
    }
    const param = m[1];
    if (param === 'level') {
      out.push('admin');
      continue;
    }
    if (param === 'provider') {
      out.push('stripe');
      continue;
    }
    let collection = out.join('/');
    if (param === 'tagId') collection = '/api/v1/tags';
    if (param === 'userId') collection = '/api/v1/users';
    if (segs[i - 1] === 'stages' && segs[i - 3] !== 'pipelines') collection = '/api/v1/pipelines';
    const key = collection + '#' + segs[i - 1];
    if (!cache.has(key)) {
      let id: string | null = null;
      if (collection) {
        const r = await owner.get(collection);
        if (r.status === 200) {
          const items = firstItems(r.json);
          if (segs[i - 1] === 'stages' && segs[i - 3] !== 'pipelines') {
            // /stages/:id : take a stage from the first pipeline
            const pid = items[0]?.id;
            const pr = pid ? await owner.get(`/api/v1/pipelines/${pid}/board`) : null;
            id = pr?.json?.columns?.[0]?.stage?.id ?? null;
          } else id = items.find((x: J) => typeof x?.id === 'string' && UUID_RE.test(x.id))?.id ?? null;
        }
      }
      cache.set(key, id);
    }
    const id = cache.get(key);
    if (!id) return null;
    out.push(id);
  }
  return out.join('/');
}
const fill = (p: string, v: string) => p.replace(/\[\w+\]/g, v);

const getQuery = (pattern: string) =>
  /availability$/.test(pattern)
    ? `?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`
    : '';
/** Plausible bodies so the 404 lookup, not Zod, is what answers the cross-workspace probe. */
function bodyHint(method: string, pattern: string): J {
  const k = `${method} ${pattern}`;
  const hints: Record<string, J> = {
    'PATCH /api/v1/contacts/[id]': { version: 0, name: 'probe' },
    'PATCH /api/v1/companies/[id]': { version: 0, name: 'probe' },
    'PATCH /api/v1/opportunities/[id]': { version: 0, title: 'probe' },
    'POST /api/v1/opportunities/[id]/move': { stageId: NIL_UUID, version: 0 },
    'POST /api/v1/contacts/[id]/tags': { tagId: NIL_UUID },
    'POST /api/v1/opportunities/[id]/tags': { tagId: NIL_UUID },
    'PATCH /api/v1/pipelines/[id]': { name: 'probe', version: 0 },
    'PATCH /api/v1/stages/[id]': { name: 'probe', version: 0 },
    'POST /api/v1/pipelines/[id]/stages': { name: 'probe', kind: 'open' },
    'POST /api/v1/pipelines/[id]/stages/reorder': { stageIds: [NIL_UUID] },
    'PATCH /api/v1/custom-fields/[id]': { label: { en: 'p', ur: 'p' }, version: 0 },
    'PATCH /api/v1/tags/[id]': { name: 'probe', version: 0 },
    'PATCH /api/v1/saved-lists/[id]': { name: 'probe', version: 0 },
    'PATCH /api/v1/users/[id]': { version: 0, baseLevel: 'admin' },
    'POST /api/v1/users/[id]/deactivate': {},
    'PUT /api/v1/users/[id]/permission-overrides': { items: [{ permission: 'crm.export', effect: 'grant' }] },
    'PATCH /api/v1/roles/[id]': { version: 0, name: 'probe' },
    'POST /api/v1/conversations/[id]/messages': {
      kind: 'text',
      text: 'probe',
      clientKey: 'probe-' + Date.now(),
    },
    'POST /api/v1/opportunities/[id]/payment-links': {
      amountMinor: 100,
      currency: 'PKR',
      clientKey: 'probe-' + Date.now(),
    },
    'POST /api/v1/conversations/[id]/opt-out': { optedOut: true },
    'PATCH /api/v1/appointments/[id]': { version: 0, title: 'probe' },
  };
  return hints[k] ?? {};
}

// ── Masking detector ────────────────────────────────────────────────────
const MONEY_KEY =
  /(^|[a-z])(value|amount|collected|projected|refunded|total|revenue|worth)(Minor|Cents)?$|Minor$/i;
/** Finds numeric money fields. `{masked:true}` shapes and null values are fine. */
function moneyLeaks(j: J, path = '$', out: string[] = [], inMoneyObj = false): string[] {
  if (Array.isArray(j)) j.slice(0, 200).forEach((x, i) => moneyLeaks(x, `${path}[${i}]`, out, inMoneyObj));
  else if (j && typeof j === 'object') {
    if (j.masked === true) return out;
    for (const [k, v] of Object.entries(j)) {
      if (
        typeof v === 'number' &&
        /(amountMinor|valueMinor|collectedMinor|totalMinor|projectedMinor|refundedMinor|^amount$)/.test(k)
      )
        out.push(`${path}.${k}=${v}`);
      else if (typeof v === 'object') moneyLeaks(v, `${path}.${k}`, out, MONEY_KEY.test(k));
    }
  } else if (inMoneyObj && typeof j === 'number') out.push(`${path}=${j}`);
  return out;
}

// ── Secret patterns ─────────────────────────────────────────────────────
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'stripe secret key', re: /sk_(test|live)_[A-Za-z0-9]{16,}/ },
  { name: 'stripe restricted key', re: /rk_(test|live)_[A-Za-z0-9]{16,}/ },
  { name: 'slack bot/user token', re: /xox[bpa]-[A-Za-z0-9-]{10,}/ },
  { name: 'slack app token', re: /xapp-\d-[A-Za-z0-9-]{10,}/ },
  { name: 'stripe webhook secret', re: /whsec_[A-Za-z0-9+/=]{16,}/ },
  { name: 'meta access token', re: /EAA[A-Za-z0-9]{40,}/ },
  { name: 'openai key', re: /sk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'google api key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'google oauth secret', re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: 'secret env var NAME in output',
    re: /\b(APP_ENCRYPTION_KEY|SESSION_SECRET|META_APP_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SLACK_SIGNING_SECRET|SLACK_BOT_TOKEN|OPENAI_API_KEY|GOOGLE_CLIENT_SECRET|QSTASH_TOKEN|CRON_SECRET|DATABASE_URL|APP_DB_PASSWORD)\b/,
  },
  { name: 'postgres URL with password', re: /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{3,}@/ },
];
/** Names (never values) of env vars whose VALUE must not appear anywhere in client-visible output. */
function secretEnvValues(): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 12) continue;
    if (
      name.startsWith('NEXT_PUBLIC_') ||
      (/PUBLIC|URL$|^PATH$|^PWD|^OLDPWD|HOME|SHELL|TERM|LANG|XDG|DISPLAY|npm_|PNPM|PROMPT|COLOR|LS_COLORS|LOGNAME/i.test(
        name,
      ) &&
        !/DATABASE_URL/.test(name))
    )
      continue;
    if (/(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|CREDENTIAL|SIGNING)/i.test(name)) out.push({ name, value });
  }
  return out;
}
function scanText(text: string, secrets: { name: string; value: string }[]): string[] {
  const hits: string[] = [];
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push(p.name);
  for (const s of secrets) if (text.includes(s.value)) hits.push(`value of env ${s.name}`);
  return hits;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Relay security probe  target=${BASE}\n`);
  const health = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!health) {
    console.error(`Cannot reach ${BASE}. Start the app first (next dev -p <port> / next start).`);
    process.exit(2);
  }

  // 1. Login
  let seedUsers: J[] | null = null;
  const anon = new Client('anon');
  const su = await anon.get('/api/dev/login-as');
  if (su.status === 200) seedUsers = su.json.users;
  const personas = [
    {
      key: 'SUNRISE_OWNER',
      label: 'Sunrise Owner',
      email: 'owner@sunrise.test',
      client: new Client('sunrise-owner'),
      ok: false,
    },
    {
      key: 'SUNRISE_USER',
      label: 'Sunrise User',
      email: 'user@sunrise.test',
      client: new Client('sunrise-user'),
      ok: false,
    },
    {
      key: 'CRESCENT_OWNER',
      label: 'Crescent Owner',
      email: 'owner@crescent.test',
      client: new Client('crescent-owner'),
      ok: false,
    },
  ] as [Persona, Persona, Persona];
  for (const p of personas) await login(p, seedUsers);
  for (const p of personas)
    check(
      'login',
      `${p.label} signed in`,
      p.ok,
      p.ok ? '' : `could not log in: ${p.why ?? 'no credentials'} (set PROBE_* env or enable dev tools)`,
    );
  if (personas.some((p) => !p.ok)) return finish();
  const [ownerP, userP, otherP] = personas;
  const [owner, user, other] = [ownerP.client, userP.client, otherP.client];
  check('login', 'workspaces differ (A vs B)', ownerP.me.workspace.id !== otherP.me.workspace.id);
  check('login', 'plain User is not Owner/Admin', userP.me.user.baseLevel === 'user');
  const userPerms = new Set<string>(userP.me.permissions);
  const userHasValue = userPerms.has('crm.opportunity.value.view');
  const ownerHasValue = new Set<string>(ownerP.me.permissions).has('crm.opportunity.value.view');
  const ownerHasUsersManage = new Set<string>(ownerP.me.permissions).has('users.manage');
  if (userHasValue)
    record(
      'F1.4 masking',
      'plain User lacks value permission',
      'FAIL',
      'seed user can see values: masking checks are vacuous',
    );
  if (!ownerHasValue || !ownerHasUsersManage)
    record('login', 'Owner holds all permissions', 'WARN', 'owner missing value/users permission');

  // 2. Enumerate routes
  const routes = enumerateRoutes();
  const total = routes.reduce((n, r) => n + r.methods.length, 0);
  console.log(`Enumerated ${routes.length} route files / ${total} method handlers under /api/v1\n`);
  check('routes', `route inventory found (${routes.length} files, ${total} handlers)`, routes.length > 20);

  const publics = routes.flatMap((r) =>
    r.methods.filter((m) => m.isPublic).map((m) => `${m.method} ${r.pattern}`),
  );
  const unexpectedPublic = publics.filter((p) => !EXPECTED_PUBLIC.has(p.split(' ')[1] ?? ''));
  check(
    'F1.5 auth',
    'only expected /api/v1 routes are public',
    unexpectedPublic.length === 0,
    unexpectedPublic.join(', '),
  );

  await ensureFixtures(owner);
  const cache = new Map<string, string | null>();
  const reqs = new Set<string>();
  const secretsEnv = secretEnvValues();

  // GET phase first (so mutation probes cannot disturb fixtures)
  const unsafeJobs: { route: RouteDef; m: RouteMethod; real: string | null }[] = [];
  const noFixture = new Set<string>();
  for (const route of routes) {
    const real = await resolvePath(route.pattern, owner, cache);
    if (route.params.length && !real) noFixture.add(route.pattern);
    for (const m of route.methods) {
      const tag = `${m.method} ${route.pattern}`;
      const safe = m.method === 'GET';
      if (!safe) {
        unsafeJobs.push({ route, m, real });
        continue;
      }
      if (m.isPublic) continue;
      const path = (real ?? fill(route.pattern, NIL_UUID)) + getQuery(route.pattern);
      const isRealId = !route.params.length || !!real;
      reqs.add(tag);

      // unauthenticated
      const u = await anon.get(path, { anonymous: true });
      check('F1.5 unauthenticated', `${tag} -> 401`, u.status === 401, `got ${u.status}`);

      // own-workspace control: the id really exists for its owner
      if (isRealId && route.params.length && !['level', 'provider'].some((x) => route.params.includes(x))) {
        const c = await owner.get(path);
        // Some routes legitimately 404/403/422 for the control (e.g. permission); only record a WARN.
        if (c.status !== 200)
          record('Q3 control', `${tag} as A-owner returns 200 for its own id`, 'WARN', `got ${c.status}`);
        // cross-workspace
        const x = await other.get(path);
        check(
          'Q3 cross-workspace',
          `${tag} as Crescent -> 404`,
          x.status === 404,
          `got ${x.status}${x.status === 200 ? ' (DATA LEAK)' : ''}`,
        );
        // non-existent id answers identically (no existence oracle)
        const nx = await other.get(
          fill(route.pattern, NIL_UUID).replace(/\[level\]|\[provider\]/g, 'x') + getQuery(route.pattern),
        );
        if (x.status !== nx.status)
          record(
            'Q3 cross-workspace',
            `${tag} A-id vs unknown-id responses identical`,
            'FAIL',
            `${x.status} vs ${nx.status}`,
          );
      }

      // permission denial for a plain user
      if (m.permission && !userPerms.has(m.permission)) {
        const d = await user.get(path);
        check(
          'F1.5 permission',
          `${tag} as User lacking ${m.permission} -> 403/404`,
          d.status === 403 || d.status === 404,
          `got ${d.status}`,
        );
      }
    }
  }
  if (noFixture.size)
    record(
      'Q3 fixtures',
      `no seed record for ${noFixture.size} :id routes`,
      'WARN',
      [...noFixture].join(', '),
    );

  // Collections: workspace B must never see A rows, even with spoofed workspace hints
  const COLLECTIONS = [
    'contacts',
    'companies',
    'opportunities',
    'pipelines',
    'tags',
    'custom-fields',
    'saved-lists',
    'users',
    'roles',
    'invites',
    'conversations',
    'appointments',
    'payments',
    'audit',
    'activities',
    'integrations',
    'integration-events',
  ];
  const wsA = ownerP.me.workspace.id as string;
  for (const c of COLLECTIONS) {
    const a = await owner.get(`/api/v1/${c}`);
    if (a.status !== 200) continue;
    const idsA = new Set(allIds(a.json));
    for (const spoof of [``, `?workspaceId=${wsA}`]) {
      const b = await other.get(`/api/v1/${c}${spoof}`, { headers: spoof ? {} : { 'x-workspace-id': wsA } });
      if (b.status !== 200) continue;
      const overlap = allIds(b.json).filter((id) => idsA.has(id));
      check(
        'Q3 cross-workspace',
        `GET /${c}${spoof ? ' ?workspaceId=<A>' : ' + x-workspace-id header'} as Crescent has no workspace-A rows`,
        overlap.length === 0,
        `${overlap.length} A ids leaked`,
      );
    }
    const flat = JSON.stringify((await other.get(`/api/v1/${c}`)).json ?? '');
    if (idsA.size && !flat.includes(wsA)) {
      /* workspace id of A not echoed to B */
    } else if (idsA.size)
      record(
        'Q3 cross-workspace',
        `GET /${c} as Crescent does not echo workspace A id`,
        'FAIL',
        'A workspace id present',
      );
  }

  // In-workspace record scope: ids the plain User cannot list must be 404 on the detail route
  for (const [list, detail] of [
    ['contacts', 'contacts'],
    ['opportunities', 'opportunities'],
  ] as const) {
    const ownerIds = allIds((await owner.get(`/api/v1/${list}`)).json);
    const userIds = new Set(allIds((await user.get(`/api/v1/${list}`)).json));
    const hidden = ownerIds.filter((id) => !userIds.has(id));
    if (!hidden.length) {
      record(
        'F1.6 record scope',
        `plain User scope on ${list}`,
        'WARN',
        'user sees every record; scope not exercised',
      );
      continue;
    }
    const bad: string[] = [];
    for (const id of hidden.slice(0, 15)) {
      const r = await user.get(`/api/v1/${detail}/${id}`);
      if (r.status !== 404) bad.push(`${id}:${r.status}`);
      for (const sub of detail === 'contacts' ? ['timeline', '360'] : ['timeline']) {
        const s = await user.get(`/api/v1/${detail}/${id}/${sub}`);
        if (s.status !== 404) bad.push(`${id}/${sub}:${s.status}`);
      }
    }
    check(
      'F1.6 record scope',
      `out-of-scope ${list} (${hidden.length} hidden of ${ownerIds.length}) -> 404 on detail/timeline/360`,
      bad.length === 0,
      bad.join(' '),
    );
  }

  // Unsafe-method probes (unauth / cross-workspace / permission). Data of A is never touched by A.
  for (const { route, m, real } of unsafeJobs) {
    if (m.isPublic) continue;
    const tag = `${m.method} ${route.pattern}`;
    reqs.add(tag);
    const path =
      real ??
      fill(route.pattern, NIL_UUID)
        .replace(/\[level\]/, 'admin')
        .replace(/\[provider\]/, 'stripe');
    const body = m.method === 'DELETE' ? {} : bodyHint(m.method, route.pattern);
    await anon.ensureCsrf();
    const u = await anon.req(m.method, path, { body });
    check('F1.5 unauthenticated', `${tag} -> 401`, u.status === 401, `got ${u.status}`);
    if (real && route.params.length && !['level', 'provider'].some((x) => route.params.includes(x))) {
      const x = await other.req(m.method, path, { body });
      const nx = await other.req(
        m.method,
        path.replace(
          real.split('/').find((s, i) => UUID_RE.test(s) && route.pattern.split('/')[i]?.startsWith('[')) ??
            '',
          NIL_UUID,
        ),
        { body },
      );
      if (x.status === 404) check('Q3 cross-workspace', `${tag} as Crescent -> 404`, true);
      else if ([400, 422].includes(x.status) && x.status === nx.status)
        record(
          'Q3 cross-workspace',
          `${tag} as Crescent -> ${x.status}`,
          'WARN',
          `validation answers before lookup; same status as an unknown id (no leak, but not provably 404)`,
        );
      else
        check(
          'Q3 cross-workspace',
          `${tag} as Crescent -> 404`,
          false,
          `got ${x.status} (unknown id: ${nx.status})${x.status < 300 ? ' (CROSS-WORKSPACE WRITE)' : ''}`,
        );
    }
    if (m.permission && !userPerms.has(m.permission)) {
      const d = await user.req(m.method, path, { body });
      check(
        'F1.5 permission',
        `${tag} as User lacking ${m.permission} -> 403/404`,
        d.status === 403 || d.status === 404,
        `got ${d.status}${d.status < 300 ? ' (PRIVILEGE ESCALATION)' : ''}`,
      );
    }
  }

  // 3. Masking ---------------------------------------------------------
  const oppId = allIds((await owner.get('/api/v1/opportunities')).json)[0];
  const pipeId = allIds((await owner.get('/api/v1/pipelines')).json)[0];
  const savedId = allIds((await owner.get('/api/v1/saved-lists')).json)[0];
  const contactId = allIds((await owner.get('/api/v1/contacts')).json)[0];
  const maskPaths = [
    '/api/v1/opportunities',
    '/api/v1/opportunities?limit=100',
    oppId && `/api/v1/opportunities/${oppId}`,
    oppId && `/api/v1/opportunities/${oppId}/timeline`,
    pipeId && `/api/v1/pipelines/${pipeId}/board`,
    '/api/v1/pipelines',
    contactId && `/api/v1/contacts/${contactId}/360`,
    contactId && `/api/v1/contacts/${contactId}/timeline`,
    savedId && `/api/v1/saved-lists/${savedId}/items`,
    '/api/v1/payments',
    '/api/v1/dashboard/overview',
    '/api/v1/dashboard/radar',
    '/api/v1/audit',
    '/api/v1/activities',
    '/api/v1/conversations',
    '/api/v1/appointments',
    '/api/v1/changes',
  ].filter(Boolean) as string[];
  let ownerSawMoney = 0;
  for (const p of maskPaths) {
    const o = await owner.get(p);
    ownerSawMoney += o.status === 200 ? moneyLeaks(o.json).length : 0;
    const r = await user.get(p);
    if (r.status === 404 || r.status === 403) {
      record(
        'F1.4 masking',
        `User GET ${p.split('?')[0]!.replace(/[0-9a-f-]{36}/g, ':id')}`,
        'PASS',
        `refused ${r.status}`,
      );
      continue;
    }
    const leaks = r.status === 200 ? moneyLeaks(r.json) : [];
    check(
      'F1.4 masking',
      `User GET ${p.split('?')[0]!.replace(/[0-9a-f-]{36}/g, ':id')} has no raw amounts`,
      r.status < 500 && leaks.length === 0,
      leaks.slice(0, 3).join('; ') || (r.status >= 500 ? `status ${r.status}` : ''),
    );
  }
  check(
    'F1.4 masking',
    'control: Owner sees raw amounts in the same endpoints (detector is not vacuous)',
    ownerSawMoney > 0,
    `${ownerSawMoney} numeric money fields seen as Owner`,
  );

  // value filter / export through the API
  const vf = Buffer.from(
    JSON.stringify({ match: 'all', clauses: [{ field: 'value', op: 'gte', value: 1 }] }),
  ).toString('base64url');
  const f1 = await user.get(`/api/v1/opportunities?filter=${vf}`);
  check(
    'F1.4 masking',
    'User cannot filter opportunities by value (inference oracle)',
    f1.status === 403 || f1.status === 400,
    `got ${f1.status}`,
  );
  const f2 = await user.get(`/api/v1/pipelines/${pipeId}/board?filter=${vf}`);
  check(
    'F1.4 masking',
    'User cannot filter the board by value',
    f2.status === 403 || f2.status === 400,
    `got ${f2.status}`,
  );
  const ex = await user.post('/api/v1/exports', { entity: 'opportunity' });
  if (ex.status === 403 || ex.status === 404)
    record('F1.4 masking', 'User POST /exports opportunity', 'PASS', `refused ${ex.status}`);
  else if (ex.status === 200) {
    const raw = new Set<string>();
    for (const o of firstItems((await owner.get('/api/v1/opportunities?limit=100')).json))
      if (o?.value && o.value.masked === false) raw.add(String(o.value.amountMinor));
    const cells = ex.text.split('\n').flatMap((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '')));
    const found = [...raw].filter((v) => v.length >= 3 && cells.includes(v));
    check(
      'F1.4 masking',
      'User CSV export of opportunities has no raw value cells',
      found.length === 0,
      `${found.length} raw amounts in CSV (checked ${raw.size} owner amounts)`,
    );
  } else
    record(
      'F1.4 masking',
      'User POST /exports opportunity',
      'FAIL',
      `unexpected status ${ex.status} ${ex.text.slice(0, 120)}`,
    );
  const ex2 = await user.post('/api/v1/exports', { entity: 'contact' });
  record(
    'F1.4 masking',
    'User POST /exports contact',
    ex2.status === 403 ? 'PASS' : 'WARN',
    `status ${ex2.status} (export needs crm.export)`,
  );

  // 4. CSRF ------------------------------------------------------------
  const csrfFails: string[] = [];
  let csrfN = 0;
  for (const route of routes) {
    for (const m of route.methods) {
      if ((m.method as string) === 'GET') continue;
      if (m.isPublic && !/auth\/login|auth\/signup|invites\/(accept|preview)/.test(route.pattern)) continue;
      const path = fill(route.pattern, NIL_UUID)
        .replace(/\[level\]/, 'admin')
        .replace(/\[provider\]/, 'stripe');
      const tag = `${m.method} ${route.pattern}`;
      csrfN++;
      const a = await owner.req(m.method, path, { body: {}, noCsrf: true });
      if (a.status !== 403 || a.json?.error?.code !== 'CSRF_FAILED')
        csrfFails.push(`${tag} no-token -> ${a.status}`);
      const b = await owner.req(m.method, path, { body: {}, origin: EVIL_ORIGIN });
      if (b.status !== 403 || b.json?.error?.code !== 'CSRF_FAILED')
        csrfFails.push(`${tag} evil-origin -> ${b.status}`);
      const c = await owner.req(m.method, path, { body: {}, origin: null });
      if (c.status !== 403) csrfFails.push(`${tag} no-origin -> ${c.status}`);
      const d = await owner.req(m.method, path, { body: {}, csrfToken: 'forged.token' });
      if (d.status !== 403) csrfFails.push(`${tag} forged-token -> ${d.status}`);
    }
  }
  check(
    'F1.5 CSRF',
    `all ${csrfN} unsafe handlers refuse: no token / foreign Origin / no Origin / forged token (403 CSRF_FAILED)`,
    csrfFails.length === 0,
    csrfFails.slice(0, 12).join('; '),
  );
  // cross-site referer fallback and a token signed by another secret
  const xr = await owner.req('POST', '/api/v1/contacts', {
    body: { name: 'x' },
    origin: null,
    headers: { referer: EVIL_ORIGIN + '/attack' },
  });
  check('F1.5 CSRF', 'foreign Referer (no Origin) is refused', xr.status === 403, `got ${xr.status}`);
  const lg = await anon.req('POST', '/api/v1/auth/login', {
    body: { email: 'x@y.zz', password: 'x' },
    anonymous: true,
    origin: EVIL_ORIGIN,
  });
  check(
    'F1.5 CSRF',
    'login POST from a foreign Origin is refused (login CSRF)',
    lg.status === 403,
    `got ${lg.status}`,
  );
  const tickNo = await anon.req('POST', '/api/internal/tick', { body: {}, anonymous: true });
  check(
    'F1.5 auth',
    '/api/internal/tick without the shared secret is refused',
    [401, 403, 404].includes(tickNo.status),
    `got ${tickNo.status}`,
  );

  // 5. XSS -------------------------------------------------------------
  await xssSection(owner, ownerP);

  // 5b. Pages as users: no 5xx, no secrets
  await pagesSection(owner, user);

  // 6. Secrets ---------------------------------------------------------
  secretsSection(secretsEnv);

  console.log(
    `API responses inspected during the run: ${SEEN.length} (${Math.round(seenBytes / 1024)} KiB)\n`,
  );
  return finish();
}

/** Seed has no invites/appointments/conversations/payments: create them in workspace A so those :id routes get a real IDOR probe. */
async function ensureFixtures(owner: Client) {
  const notes: string[] = [];
  if (!allIds((await owner.get('/api/v1/invites')).json).length) {
    const r = await owner.post('/api/v1/invites', { baseLevel: 'user' });
    if (r.status !== 201) notes.push(`invite ${r.status}`);
  }
  if (!allIds((await owner.get('/api/v1/appointments')).json).length) {
    const start = new Date(Date.now() + 3 * 864e5);
    start.setUTCHours(9, 0, 0, 0);
    const r = await owner.post('/api/v1/appointments', {
      title: 'probe fixture',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 36e5).toISOString(),
      timezone: 'Asia/Karachi',
    });
    if (r.status !== 201 && r.status !== 200) notes.push(`appointment ${r.status} ${r.text.slice(0, 100)}`);
  }
  if (!allIds((await owner.get('/api/v1/conversations')).json).length) {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !(IS_LOCAL || process.env.PROBE_FIXTURES === '1'))
      notes.push('conversation: needs META_APP_SECRET + local target (or PROBE_FIXTURES=1)');
    else {
      const wamid = `wamid.PROBE${Math.random().toString(36).slice(2, 14)}`;
      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15550000000',
                    phone_number_id: process.env.META_PHONE_NUMBER_ID ?? 'x',
                  },
                  contacts: [{ profile: { name: 'Probe Fixture' }, wa_id: '923009990001' }],
                  messages: [
                    {
                      from: '923009990001',
                      id: wamid,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'probe fixture' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      const sig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
      const w = await fetch(`${BASE}/api/webhooks/meta/default`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
        body: payload,
      });
      // processing runs after the 200 (outbox/after()); poll until the conversation shows up
      let found = false;
      for (let i = 0; i < 20 && !found; i++) {
        found = allIds((await owner.get('/api/v1/conversations')).json).length > 0;
        if (!found) await owner.post('/api/v1/tick-nudge', {}).catch(() => null);
        if (!found) await new Promise((r) => setTimeout(r, 500));
      }
      if (!found) notes.push(`conversation: signed webhook ${w.status} but no conversation visible to Owner`);
    }
  }
  if (!allIds((await owner.get('/api/v1/payments')).json).length) {
    const oppId = allIds((await owner.get('/api/v1/opportunities')).json)[0];
    const r = oppId
      ? await owner.post(`/api/v1/opportunities/${oppId}/payment-links`, {
          amountMinor: 1000,
          currency: 'PKR',
          clientKey: `probe-${Date.now()}`,
        })
      : null;
    if (!r || (r.status !== 201 && r.status !== 200))
      notes.push(`payment link ${r?.status} ${r?.text.slice(0, 100)}`);
  }
  if (notes.length) record('Q3 fixtures', 'could not create every fixture', 'WARN', notes.join(' | '));
}

const XSS = '<img src=x onerror=alert(1)>';
const TPL = '{{constructor}}';
async function xssSection(owner: Client, ownerP: Persona) {
  const rnd = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
  const created: { contact?: string; field?: string } = {};
  const A = 'Q3 XSS';
  const f = await owner.post('/api/v1/custom-fields', {
    entity: 'contact',
    pipelineId: null,
    key: `probe_xss_${rnd}`,
    label: { en: XSS, ur: TPL },
    type: 'text',
    options: [],
  });
  if (f.status !== 201 && f.status !== 200)
    record(A, 'create custom field with payload label', 'FAIL', `status ${f.status} ${f.text.slice(0, 200)}`);
  else created.field = f.json.id;
  const fieldId = created.field;
  const c = await owner.post('/api/v1/contacts', {
    name: XSS,
    phone: `0300${rnd.slice(1)}`,
    email: `probe${rnd}@example.com`,
    fields: fieldId ? { [fieldId]: TPL } : undefined,
  });
  if (c.status !== 201 && c.status !== 200) {
    record(A, 'create contact with payload name', 'FAIL', `status ${c.status} ${c.text.slice(0, 200)}`);
    return;
  }
  created.contact = c.json.id;
  const cid: string = c.json.id;
  check(
    A,
    'contact name stored verbatim as text',
    c.json.name === XSS,
    `name=${JSON.stringify(c.json.name)}`,
  );
  if (fieldId)
    check(
      A,
      'custom field value stored verbatim as text',
      c.json.fields?.[fieldId] === TPL,
      JSON.stringify(c.json.fields),
    );
  const n = await owner.post('/api/v1/activities', {
    contactId: cid,
    type: 'note',
    body: `${XSS} ${TPL} <script>alert(2)</script>`,
  });
  check(
    A,
    'note with HTML/template payload accepted',
    n.status === 201 || n.status === 200,
    `status ${n.status}`,
  );
  const g = await owner.get(`/api/v1/contacts/${cid}`);
  check(
    A,
    'GET contact returns payload unchanged and as JSON',
    g.json?.name === XSS && /application\/json/.test(g.headers.get('content-type') ?? ''),
    g.headers.get('content-type') ?? '',
  );
  const tl = await owner.get(`/api/v1/contacts/${cid}/timeline`);
  check(
    A,
    'timeline returns note payload as JSON text',
    JSON.stringify(tl.json).includes('<script>alert(2)</script>') ||
      JSON.stringify(tl.json).includes('\\u003cscript'),
    '',
  );
  // CSV formula injection guard
  const fx = await owner.post('/api/v1/contacts', {
    name: '=HYPERLINK("http://evil","x")',
    phone: `0301${rnd.slice(1)}`,
  });
  if (fx.status === 201 || fx.status === 200) {
    const ex = await owner.post('/api/v1/exports', { entity: 'contact' });
    const bad = ex.status === 200 && /(^|,|\n)"?=HYPERLINK/.test(ex.text);
    check(
      A,
      'CSV export neutralises =formula cells',
      ex.status === 200 && !bad,
      `export status ${ex.status}`,
    );
    await owner.del(`/api/v1/contacts/${fx.json.id}`);
  }

  // SSR HTML: payload must never appear unescaped
  const pages = [`/contacts/${cid}`, '/contacts', '/settings/fields', `/ur/contacts/${cid}`];
  for (const p of pages) {
    const r = await owner.get(p);
    const raw = /<img src=x onerror/i.test(r.text) || /<script>alert\(2\)/.test(r.text);
    check(A, `SSR ${p} has no raw payload HTML`, r.status < 500 && !raw, `status ${r.status}`);
  }

  // Real browser DOM (client-rendered data is what actually matters)
  await browserXss(owner, ownerP, cid, pages).catch((e) =>
    record(
      'Q3 XSS (browser)',
      'rendered DOM check',
      'WARN',
      `browser run failed: ${(e as Error).message.split('\n')[0]}`,
    ),
  );

  // cleanup
  await owner.del(`/api/v1/contacts/${cid}`);
  if (fieldId) await owner.del(`/api/v1/custom-fields/${fieldId}`);
}

async function browserXss(owner: Client, ownerP: Persona, cid: string, pages: string[]) {
  const A = 'Q3 XSS (browser)';
  let pw: J;
  try {
    pw = await import('@playwright/test');
  } catch {
    return record(A, 'rendered DOM check', 'SKIP', 'playwright not installed');
  }
  let browser: J;
  try {
    try {
      browser = await pw.chromium.launch();
    } catch {
      const root = join(process.env.HOME ?? '', '.cache/ms-playwright');
      const exe = existsSync(root)
        ? readdirSync(root)
            .filter((d) => /^chromium-\d+$/.test(d))
            .sort()
            .reverse()
            .flatMap((d) => ['chrome-linux64/chrome', 'chrome-linux/chrome'].map((x) => join(root, d, x)))
            .find(existsSync)
        : undefined;
      if (!exe) throw new Error('no chromium found; run `pnpm exec playwright install chromium`');
      browser = await pw.chromium.launch({ executablePath: exe });
    }
  } catch (e) {
    return record(
      A,
      'rendered DOM check',
      'SKIP',
      `chromium unavailable: ${(e as Error).message.split('\n')[0]}`,
    );
  }
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies(
      [...owner.jar].map(([name, value]) => ({
        name,
        value,
        domain: new URL(BASE).hostname,
        path: '/',
        secure: name.startsWith('__Host-') || BASE.startsWith('https'),
        httpOnly: /sid$/.test(name),
      })),
    );
    const page = await ctx.newPage();
    const dialogs: string[] = [];
    page.on('dialog', async (d: J) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    for (const p of pages.filter((x) => !x.startsWith('/ur'))) {
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => null);
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => ({
        injectedImg: (globalThis as J).document.querySelectorAll('img[src="x"], img[onerror]').length,
        injectedScript: [...(globalThis as J).document.querySelectorAll('script')].filter(
          (s) => s.textContent?.includes('alert(2)') && !s.src && !s.type,
        ).length,
        text: (globalThis as J).document.body.innerText,
        url: (globalThis as J).location.pathname,
      }));
      check(
        A,
        `${p}: payload is not parsed as HTML (no <img onerror>) and no alert fired`,
        info.injectedImg === 0 && dialogs.length === 0,
        `imgs=${info.injectedImg} dialogs=${dialogs.length} landed=${info.url}`,
      );
      const shown = info.text.includes(XSS);
      if (p.startsWith('/contacts/')) {
        if (shown) record(A, `${p}: payload shown as literal text`, 'PASS');
        else
          record(
            A,
            `${p}: payload shown as literal text`,
            'WARN',
            `payload not visible (landed ${info.url}); render path not exercised`,
          );
        check(
          A,
          `${p}: {{constructor}} rendered literally, not evaluated`,
          !/\[native code\]|function Object|\[object /.test(info.text),
          '',
        );
      }
    }
  } finally {
    await browser.close();
  }
  void ownerP;
}

async function pagesSection(owner: Client, user: Client) {
  const pageFiles = walk(join(ROOT, 'apps/web/app/[locale]'), 'page.tsx');
  const paths = pageFiles
    .map((f) =>
      relative(join(ROOT, 'apps/web/app/[locale]'), join(f, '..'))
        .split(sep)
        .filter((s) => !/^\(.*\)$/.test(s))
        .join('/'),
    )
    .filter((p) => !p.includes('[') && !p.startsWith('dev'))
    .map((p) => '/' + p);
  const bad: string[] = [];
  for (const p of paths)
    for (const c of [owner, user]) {
      const r = await c.get(p === '/' ? '/' : p);
      if (r.status >= 500) bad.push(`${c.name} ${p} -> ${r.status}`);
    }
  check(
    'Q3 pages',
    `${paths.length} app pages render without 5xx for Owner and User`,
    bad.length === 0,
    bad.join('; '),
  );
  // anonymous visit to a gated page redirects to login, never leaks
  const anonR = await new Client('anon').get('/contacts', { anonymous: true });
  check(
    'F1.5 pages',
    'anonymous GET /contacts redirects to login (no data in body)',
    [302, 303, 307, 308].includes(anonR.status) || anonR.status === 401,
    `got ${anonR.status}`,
  );
}

function secretsSection(secretsEnv: { name: string; value: string }[]) {
  const A = 'Q9 secrets';
  record(A, `checking ${secretsEnv.length} secret-looking env values (names only reported)`, 'PASS');
  // client bundle
  const dirs = [
    join(ROOT, 'apps/web/.next/static'),
    ...(process.env.PROBE_STATIC_DIR ? [process.env.PROBE_STATIC_DIR] : []),
  ].filter(existsSync);
  if (!dirs.length)
    record(A, 'client bundle (apps/web/.next/static)', 'SKIP', 'no build output: run `pnpm build` first');
  for (const d of dirs) {
    const files = walkAll(d).filter((f) => /\.(js|css|html|json|map|txt)$/.test(f));
    const hits = new Set<string>();
    for (const f of files)
      for (const h of scanText(readFileSync(f, 'utf8'), secretsEnv)) hits.add(`${h} in ${relative(ROOT, f)}`);
    check(
      A,
      `client bundle clean (${files.length} files in ${relative(ROOT, d)})`,
      hits.size === 0,
      [...hits].slice(0, 8).join('; '),
    );
  }
  // every response collected
  const hits = new Set<string>();
  for (const s of SEEN) for (const h of scanText(s.body, secretsEnv)) hits.add(`${h} in [${s.where}]`);
  check(
    A,
    `${SEEN.length} API/page responses collected during the run contain no secrets`,
    hits.size === 0,
    [...hits].slice(0, 8).join('; '),
  );
  // headers: no server-version leakage
  // git grep
  try {
    const patterns = [
      'sk_(test|live)_[A-Za-z0-9]{20,}',
      'xox[bpa]-[0-9A-Za-z-]{20,}',
      'whsec_[A-Za-z0-9]{20,}',
      'EAA[A-Za-z0-9]{50,}',
      'sk-proj-[A-Za-z0-9_-]{20,}',
      '-----BEGIN [A-Z ]*PRIVATE KEY-----',
      'AIza[0-9A-Za-z_-]{35}',
      'GOCSPX-[A-Za-z0-9_-]{20,}',
      'postgres(ql)?://[a-z_]+:[^@$\\{\\s"\']{6,}@(?!localhost|127\\.0\\.0\\.1|db[:/])',
    ];
    const out = execGrep(patterns);
    // Hits inside *.test.ts are deliberately fake fixtures (reviewed by hand); anything else fails.
    const real = out.filter((h) => !/\.test\.[tj]sx?:|\/test\//.test(h));
    const fixtures = out.filter((h) => !real.includes(h));
    check(
      A,
      'git grep: no secret-shaped literals in tracked non-test files (excluding .env.example)',
      real.length === 0,
      real.slice(0, 8).join('; '),
    );
    if (fixtures.length)
      record(
        A,
        'git grep: secret-shaped strings in test files',
        'WARN',
        `${fixtures.join('; ')} (fake fixtures: verify by eye)`,
      );
    const envTracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /(^|\/)\.env(\.[a-z]+)*$/.test(f) && !f.endsWith('.env.example'));
    check(A, 'no .env files are tracked by git', envTracked.length === 0, envTracked.join(', '));
  } catch (e) {
    record(A, 'git grep', 'SKIP', (e as Error).message.split('\n')[0]);
  }
}
function execGrep(patterns: string[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    try {
      const o = execFileSync(
        'git',
        [
          'grep',
          '-I',
          '-n',
          '-P',
          '-e',
          p,
          '--',
          '.',
          ':!*.env.example',
          ':!pnpm-lock.yaml',
          ':!apps/web/.env.example',
          ':!scripts/probe-security.ts',
        ],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      for (const line of o.split('\n').filter(Boolean)) hits.push(line.split(':').slice(0, 2).join(':'));
    } catch {
      /* exit 1 = no match */
    }
  }
  return hits;
}
function walkAll(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else out.push(p);
  }
  return out;
}

function finish() {
  const order: Status[] = ['FAIL', 'WARN', 'SKIP', 'PASS'];
  const areas = [...new Set(results.map((r) => r.area))];
  console.log('Rubric-style report');
  console.log('='.repeat(100));
  for (const a of areas) {
    const rs = results.filter((r) => r.area === a);
    const c = (s: Status) => rs.filter((r) => r.status === s).length;
    console.log(
      `${c('FAIL') ? 'FAIL' : 'PASS'}  ${a.padEnd(24)} pass=${c('PASS')} fail=${c('FAIL')} warn=${c('WARN')} skip=${c('SKIP')}`,
    );
  }
  console.log('='.repeat(100));
  const fails = results.filter((r) => r.status === 'FAIL');
  const notPass = results
    .filter((r) => r.status !== 'PASS')
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  for (const r of notPass)
    console.log(`${r.status.padEnd(5)} [${r.area}] ${r.id}${r.detail ? `\n        ${r.detail}` : ''}`);
  console.log(
    `\nTOTAL ${results.length} checks: ${results.filter((r) => r.status === 'PASS').length} pass, ${fails.length} FAIL, ${results.filter((r) => r.status === 'WARN').length} warn, ${results.filter((r) => r.status === 'SKIP').length} skip`,
  );
  if (WANT_JSON) console.log(JSON.stringify(results, null, 2));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
