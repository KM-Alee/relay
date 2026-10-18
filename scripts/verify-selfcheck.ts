// Production self-check walker (docs/14-rubric.md §1, organisers' Self-Check List). Lane Q.
//
//   pnpm exec tsx scripts/verify-selfcheck.ts [baseUrl]      (default https://relay-eta-silk.vercel.app)
//   env: SELFCHECK_PASSWORD (seed password), SELFCHECK_JARS (cookie-jar file, default reports/selfcheck/jars.json)
//
// Talks to the RUNNING app over real HTTP (cookie jar + CSRF) and drives a real Chromium where the UI matters.
// Sessions are persisted to the jar file and reused: password login is rate-limited 5 / 15 min per email.
// Every item is recorded PASS / FAIL / HUMAN (needs a person: OAuth, a phone, a card) with evidence.
// Demo data it changes (availability, time-warp, escalation policy) is restored at the end.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BASE = (process.argv[2] ?? 'https://relay-eta-silk.vercel.app').replace(/\/$/, '');
const OUT = join(ROOT, 'reports/selfcheck');
const JARS = process.env.SELFCHECK_JARS ?? join(OUT, 'jars.json');
const PASSWORD = process.env.SELFCHECK_PASSWORD ?? '';
mkdirSync(OUT, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
type Status = 'PASS' | 'FAIL' | 'HUMAN';
const results: { item: string; status: Status; evidence: string }[] = [];
function rec(item: string, status: Status, evidence: string) {
  results.push({ item, status, evidence });
  console.log(`${status.padEnd(5)} ${item} :: ${evidence}`);
}
const ok = (item: string, cond: boolean, evidence: string) => rec(item, cond ? 'PASS' : 'FAIL', evidence);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)); // test pacing only, not business timers
const stamp = Date.now().toString(36);

const jars: Record<string, Record<string, string>> = existsSync(JARS)
  ? JSON.parse(readFileSync(JARS, 'utf8'))
  : {};
const saveJars = () => writeFileSync(JARS, JSON.stringify(jars));

class Client {
  constructor(readonly name: string) {}
  get jar() {
    return (jars[this.name] ??= {});
  }
  async req(method: string, path: string, body?: unknown): Promise<{ s: number; j: J }> {
    const h: Record<string, string> = {
      cookie: Object.entries(this.jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    };
    if (method !== 'GET') {
      h['x-csrf-token'] = this.jar.csrf ?? '';
      h.origin = BASE;
      if (body !== undefined) h['content-type'] = 'application/json';
    }
    const r = await fetch(BASE + path, {
      method,
      headers: h,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    for (const sc of r.headers.getSetCookie()) {
      const p = sc.split(';')[0] ?? '';
      const i = p.indexOf('=');
      const k = p.slice(0, i);
      const v = p.slice(i + 1);
      if (!v) delete this.jar[k];
      else this.jar[k] = v;
    }
    saveJars();
    const t = await r.text();
    let j: J = t;
    try {
      j = JSON.parse(t);
    } catch {
      /* html */
    }
    return { s: r.status, j };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  del = (p: string, b?: unknown) => this.req('DELETE', p, b);
  async login(email: string): Promise<J> {
    const me = await this.get('/api/v1/me');
    if (me.s === 200) return me.j;
    if (!PASSWORD) throw new Error(`no session for ${email} and SELFCHECK_PASSWORD unset`);
    await this.get('/api/v1/csrf');
    const r = await this.post('/api/v1/auth/login', { email, password: PASSWORD });
    if (r.s !== 200) throw new Error(`login ${email} -> ${r.s}`);
    return r.j;
  }
}

const owner = new Client('owner');
const user = new Client('user');
const crescent = new Client('crescent');
const anon = new Client('anon');

async function browser() {
  const pw = await import('@playwright/test');
  try {
    return await pw.chromium.launch();
  } catch {
    const root = join(process.env.HOME ?? '', '.cache/ms-playwright');
    const dir = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .at(-1);
    return pw.chromium.launch({ executablePath: join(root, dir ?? '', 'chrome-linux64/chrome') });
  }
}
function cookiesFor(c: Client) {
  const host = new URL(BASE).hostname;
  return Object.entries(c.jar).map(([name, value]) => ({
    name,
    value,
    domain: host,
    path: '/',
    secure: BASE.startsWith('https'),
    sameSite: 'Lax' as const,
  }));
}
const leadByName = async (name: string): Promise<J> => {
  const r = await owner.get('/api/v1/leads?view=all&limit=50');
  return (r.j.items ?? []).find((l: J) => l.contactName === name);
};

async function main() {
  const meO = await owner.login('owner@sunrise.test');
  const meU = await user.login('user@sunrise.test');
  await crescent.login('owner@crescent.test');
  const sunriseUsers = (await owner.get('/api/v1/users')).j.items as J[];
  const user2 = sunriseUsers.find((u) => u.email === 'user2@sunrise.test');
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(cookiesFor(owner));
  const page = await ctx.newPage();

  // ── 1. Roles, permissions, security ────────────────────────────────
  try {
    await page.goto(`${BASE}/en/team`);
    await page.getByRole('tab', { name: /invites/i }).click();
    await page
      .getByRole('button', { name: /^invite$/i })
      .first()
      .click();
    await page.getByRole('button', { name: /create link/i }).click();
    const link = await page.getByLabel(/invite link/i).inputValue({ timeout: 15_000 });
    ok(
      '1a Owner invites a user in the UI',
      /\/invite\//.test(link),
      `UI dialog returned link ${link.replace(/[^/]+$/, '<token>')}`,
    );
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'fail-invite.png') });
    rec('1a Owner invites a user in the UI', 'FAIL', (e as Error).message.split('\n')[0]!);
  }
  {
    const before = (await owner.get(`/api/v1/users/${user2.id}/permission-overrides`)).j;
    const put = await owner.put(`/api/v1/users/${user2.id}/permission-overrides`, {
      items: [{ permission: 'crm.export', effect: 'grant' }],
    });
    const has = (put.j.effective ?? []).includes('crm.export');
    await owner.put(`/api/v1/users/${user2.id}/permission-overrides`, {
      items: (before.items ?? []).map((i: J) => ({ permission: i.permission, effect: i.effect })),
    });
    await page.goto(`${BASE}/en/team/roles`);
    const boxes = await page.locator('[role=checkbox], input[type=checkbox], [role=switch]').count();
    ok(
      '1b Owner changes permissions (roles page + override API)',
      put.s === 200 && has && boxes > 0,
      `override PUT ${put.s}, effective has crm.export=${has}, roles matrix controls=${boxes} (reverted)`,
    );
  }
  {
    const o = await user.get('/api/v1/opportunities?limit=50');
    const items = o.j.items ?? [];
    const leaked = items.filter((x: J) => !x.value?.masked || 'amountMinor' in (x.value ?? {}));
    const d = await user.get('/api/v1/dashboard/overview');
    ok(
      '1c Plain user API: opportunity values masked',
      o.s === 200 && items.length > 0 && leaked.length === 0 && d.j.payments?.total?.masked === true,
      `${items.length} opps as ${meU.user.email}, ${leaked.length} unmasked; dashboard payments masked=${d.j.payments?.total?.masked}`,
    );
  }
  {
    const a = await anon.get('/api/v1/contacts');
    const oppId = (await owner.get('/api/v1/opportunities?limit=1')).j.items[0].id;
    const x = await crescent.get(`/api/v1/opportunities/${oppId}`);
    const xc = await crescent.get(`/api/v1/users/${meO.user.id}`);
    ok(
      '1d Unauthenticated 401; other workspace id 404',
      a.s === 401 && x.s === 404 && xc.s === 404,
      `anon GET /contacts ${a.s}; Crescent GET Sunrise opp ${x.s}, Sunrise user ${xc.s}`,
    );
  }

  // ── 2. Customizable CRM ────────────────────────────────────────────
  const contacts = (await owner.get('/api/v1/contacts?limit=5')).j.items as J[];
  try {
    const key = `sc_${stamp}`;
    await page.goto(`${BASE}/en/settings/fields`);
    const form = page.getByRole('form', { name: /add a field/i });
    await form.getByLabel(/applies to/i).selectOption('contact');
    await form.getByLabel(/^key/i).fill(key);
    await form.getByLabel(/label \(english\)/i).fill(`Selfcheck ${stamp}`);
    await form.getByRole('button', { name: /create field/i }).click();
    await page.getByText(`Selfcheck ${stamp}`).first().waitFor({ timeout: 15_000 });
    await page.goto(`${BASE}/en/contacts/${contacts[0].id}`);
    const seen = await page
      .getByText(`Selfcheck ${stamp}`)
      .first()
      .waitFor({ timeout: 20_000 })
      .then(
        () => true,
        () => false,
      );
    ok(
      '2a Custom field created in UI appears on a contact immediately',
      seen,
      `field ${key} created via /settings/fields, visible on /contacts/${contacts[0].id}=${seen}`,
    );
    const f = ((await owner.get('/api/v1/custom-fields?entity=contact')).j.items as J[]).find(
      (x) => x.key === key,
    );
    if (f) await owner.del(`/api/v1/custom-fields/${f.id}`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'fail-field.png') });
    rec(
      '2a Custom field created in UI appears on a contact immediately',
      'FAIL',
      (e as Error).message.split('\n')[0]!,
    );
  }
  const pipes = (await owner.get('/api/v1/pipelines')).j.items as J[];
  const [p1, p2] = pipes;
  const pf = await owner.post('/api/v1/custom-fields', {
    entity: 'opportunity',
    pipelineId: p2.id,
    key: `scp_${stamp}`,
    label: { en: 'Selfcheck kW', ur: 'Selfcheck kW' },
    type: 'number',
  });
  {
    const f1 = (
      (await owner.get(`/api/v1/custom-fields?entity=opportunity&pipelineId=${p1.id}`)).j.items as J[]
    ).map((x) => x.key);
    const f2 = (
      (await owner.get(`/api/v1/custom-fields?entity=opportunity&pipelineId=${p2.id}`)).j.items as J[]
    ).map((x) => x.key);
    ok(
      '2b Two pipelines have different fields',
      pf.s === 201 && f2.includes(`scp_${stamp}`) && !f1.includes(`scp_${stamp}`),
      `${p1.name}: [${f1}] vs ${p2.name}: [${f2}]`,
    );
  }
  {
    const add = await owner.post(`/api/v1/pipelines/${p2.id}/stages`, { name: `SC ${stamp}` });
    const st = add.j.stages?.find((s: J) => s.name === `SC ${stamp}`) ?? add.j;
    const ren = await owner.patch(`/api/v1/stages/${st.id}`, {
      name: `SC2 ${stamp}`,
      version: st.version ?? 0,
      requiredFieldIds: [pf.j.id],
    });
    const ids = ((await owner.get('/api/v1/pipelines')).j.items as J[])
      .find((p) => p.id === p2.id)
      .stages.map((s: J) => s.id);
    const re = await owner.post(`/api/v1/pipelines/${p2.id}/stages/reorder`, {
      stageIds: [st.id, ...ids.filter((i: string) => i !== st.id)],
    });
    const after = ((await owner.get('/api/v1/pipelines')).j.items as J[]).find((p) => p.id === p2.id).stages;
    const first = after.sort((a: J, c: J) => a.position - c.position)[0];
    ok(
      '2c Stage added, renamed, reordered',
      add.s < 300 && ren.s === 200 && re.s < 300 && first.id === st.id && first.name === `SC2 ${stamp}`,
      `add ${add.s}, rename ${ren.s}, reorder ${re.s}, first stage now "${first.name}"`,
    );
    // 2d required field gate
    const opp = await owner.post('/api/v1/opportunities', {
      contactId: contacts[0].id,
      pipelineId: p2.id,
      stageId: ids.find((i: string) => i !== st.id),
      title: `SC opp ${stamp}`,
    });
    const blocked = await owner.post(`/api/v1/opportunities/${opp.j.id}/move`, {
      stageId: st.id,
      version: opp.j.version,
    });
    const filled = await owner.post(`/api/v1/opportunities/${opp.j.id}/move`, {
      stageId: st.id,
      version: opp.j.version,
      fields: { [pf.j.id]: 12 },
    });
    ok(
      '2d Stage move blocked until required fields filled',
      blocked.s === 422 && blocked.j.error?.code === 'REQUIRED_FIELDS_MISSING' && filled.s === 200,
      `move w/o field ${blocked.s} ${blocked.j.error?.code}; with field ${filled.s}`,
    );
    await owner.del(`/api/v1/opportunities/${opp.j.id}`);
    await owner.del(`/api/v1/stages/${st.id}`, {});
    await owner.del(`/api/v1/custom-fields/${pf.j.id}`);
  }
  {
    const list = ((await owner.get('/api/v1/saved-lists')).j.items as J[])[0];
    const tagId = list.criteria.clauses.find((c: J) => c.field === 'tag')?.value?.[0];
    const n0 = ((await owner.get(`/api/v1/saved-lists/${list.id}/items?limit=100`)).j.items ?? []).length;
    const c = await owner.post('/api/v1/contacts', { name: `SC list ${stamp}` });
    await owner.post(`/api/v1/contacts/${c.j.id}/tags`, { tagId });
    const n1 = ((await owner.get(`/api/v1/saved-lists/${list.id}/items?limit=100`)).j.items ?? []).length;
    ok(
      '2e Saved list updates automatically',
      n1 === n0 + 1,
      `"${list.name}" ${n0} -> ${n1} after tagging a new contact`,
    );
    await owner.del(`/api/v1/contacts/${c.j.id}`);
  }
  {
    let best = { id: '', types: [] as string[] };
    for (const c of contacts) {
      const t = await owner.get(`/api/v1/contacts/${c.id}/timeline?limit=100`);
      const types = [...new Set(((t.j.items ?? []) as J[]).map((i) => i.type ?? i.kind))];
      if (types.length > best.types.length) best = { id: c.id, types };
    }
    const r360 = await owner.get(`/api/v1/contacts/${best.id}/360`);
    ok(
      '2f Contact shows full history',
      best.types.length >= 2 && r360.s === 200,
      `contact ${best.id} timeline types [${best.types}]; 360 ${r360.s}; related keys [${Object.keys(r360.j.related ?? {})}]`,
    );
  }

  // ── 3. Lead assignment + escalation ────────────────────────────────
  const restoreAvail: string[] = [];
  {
    const off = await owner.patch(`/api/v1/users/${user2.id}/availability`, { availability: 'offline' });
    restoreAvail.push(user2.id);
    const name = `SC form ${stamp}`;
    const f = await anon.post('/api/public/forms/sunrise-solar', {
      name,
      phone: `+92300${String(Date.now()).slice(-7)}`,
      message: 'self-check',
      website: '',
    });
    await sleep(1500);
    const lead = await leadByName(name);
    ok(
      '3a Web form creates a lead with an owner',
      f.s < 300 && !!lead?.owner?.id,
      `form POST ${f.s}; lead ${lead?.id} owner ${lead?.owner?.name}`,
    );
    ok(
      '3c Only Available employees get leads',
      off.s === 200 && !!lead && lead.owner?.id !== user2.id,
      `user2 set offline (${off.s}); new lead owner ${lead?.owner?.name}`,
    );
    if (lead) {
      const lp = await ctx.newPage();
      await lp.goto(`${BASE}/en/leads/${lead.id}`);
      const t1 = await lp.locator('body').innerText();
      await sleep(2500);
      const t2 = await lp.locator('body').innerText();
      const timer = (await lp.locator('[role=timer], [aria-live], svg circle').count()) > 0;
      ok(
        '3b Visible countdown on the lead',
        timer && t1 !== t2,
        `countdown element=${timer}, text ticking=${t1 !== t2}`,
      );
      await lp.close();
      // 3e owner goes offline → immediate reassignment
      const ownerId = lead.owner.id;
      const r = await owner.patch(`/api/v1/users/${ownerId}/availability`, { availability: 'offline' });
      restoreAvail.push(ownerId);
      const now = (await owner.get(`/api/v1/leads/${lead.id}`)).j;
      ok(
        '3d Owner Offline reassigns immediately',
        r.s === 200 && (r.j.reassignedLeadIds ?? []).includes(lead.id) && now.owner.id !== ownerId,
        `${lead.owner.name} offline -> reassigned=${(r.j.reassignedLeadIds ?? []).includes(lead.id)}, owner now ${now.owner?.name}`,
      );
    }
    for (const id of restoreAvail)
      await owner.patch(`/api/v1/users/${id}/availability`, { availability: 'available' });
  }
  {
    const name = `SC manual ${stamp}`;
    const m = await owner.post('/api/v1/leads', {
      contactName: name,
      phone: `+92301${String(Date.now()).slice(-7)}`,
      sourceKey: 'walk_in',
    });
    ok(
      '3e Manual entry creates a lead',
      m.s === 201 && !!m.j.owner?.id,
      `POST /leads ${m.s}; owner ${m.j.owner?.name}; ackWindowEndsAt ${m.j.ackWindowEndsAt}`,
    );
  }
  {
    const rq = await owner.get('/api/v1/recovery');
    const reasons = Array.isArray(rq.j?.items)
      ? [...new Set(rq.j.items.flatMap((i: J) => i.reasons ?? []))]
      : [];
    ok(
      '3f Recovery queue shows the reason',
      rq.s === 200 && reasons.length > 0,
      `GET /api/v1/recovery ${rq.s}${rq.s === 404 && typeof rq.j === 'string' ? ' (route not in the deployed build)' : ''}; reasons [${reasons}]`,
    );
  }
  {
    const pol = ((await owner.get('/api/v1/escalation-policies')).j.items as J[])[0];
    const orig = {
      repeatCount: pol.repeatCount,
      levels: pol.levels.map((l: J) => ({
        targetType: l.targetType,
        targetUserId: l.targetUserId,
        timeoutSeconds: l.timeoutSeconds,
      })),
    };
    const pub = await owner.put(`/api/v1/escalation-policies/${pol.id}`, {
      version: pol.version,
      repeatCount: 1,
      levels: [
        { targetType: 'next_eligible', timeoutSeconds: 60 },
        { targetType: 'team_manager', timeoutSeconds: 60 },
      ],
    });
    const warp = await owner.put('/api/v1/time-warp', { multiplier: 60 });
    const name = `SC esc ${stamp}`;
    const m = await owner.post('/api/v1/leads', {
      contactName: name,
      phone: `+92302${String(Date.now()).slice(-7)}`,
      sourceKey: 'walk_in',
    });
    let detail: J;
    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      await owner.post('/api/v1/tick-nudge');
      detail = (await owner.get(`/api/v1/leads/${m.j.id}`)).j;
      if ((detail.escalationCount ?? 0) >= 1) break;
    }
    await sleep(4000);
    detail = (await owner.get(`/api/v1/leads/${m.j.id}`)).j;
    const esc = ((detail?.events ?? []) as J[]).filter((e) => /escalat/.test(e.type));
    // Once = within each cycle (split by overdue_attempt) levels strictly increase and no deadline fires twice.
    const evs = ((detail?.events ?? []) as J[]).filter(
      (e) => e.type === 'escalation' || e.type === 'overdue_attempt',
    );
    let last = 0;
    let dup = 0;
    for (const e of evs) {
      if (e.type === 'overdue_attempt') last = 0;
      else if ((e.escalationLevel ?? 0) <= last) dup++;
      else last = e.escalationLevel ?? 0;
    }
    const levels = evs.map((e) => (e.type === 'escalation' ? `L${e.escalationLevel}` : 'overdue'));
    const once = esc.length > 0 && dup === 0;
    ok(
      '3g Expired lead escalates once per level, configurable levels/times',
      pub.s === 200 && warp.s === 200 && once,
      `policy published 2 levels x60s (${pub.s}), warp 60x (${warp.s}); sequence [${levels}] duplicates=${dup}; owner ${detail?.owner?.name}`,
    );
    await owner.put('/api/v1/time-warp', { multiplier: 1 });
    const cur = ((await owner.get('/api/v1/escalation-policies')).j.items as J[])[0];
    await owner.put(`/api/v1/escalation-policies/${pol.id}`, { version: cur.version, ...orig });
  }

  // ── 4. Audit log + dashboard ───────────────────────────────────────
  {
    const a = await owner.get('/api/v1/audit?limit=50');
    const items = (a.j.items ?? []) as J[];
    const full = items.find((i) => i.occurredAt && i.before && i.after && (i.actorName || i.actorType));
    const patch = await owner.patch(`/api/v1/audit/${items[0]?.id}`, {});
    const del = await owner.del(`/api/v1/audit/${items[0]?.id}`);
    await page.goto(`${BASE}/en/audit`);
    const ctrls = await page.getByRole('button', { name: /^(edit|delete)$/i }).count();
    ok(
      '4a Audit shows who/when/before/after; no edit/delete',
      !!full && patch.s >= 400 && del.s >= 400 && ctrls === 0,
      `entry ${full?.action} by ${full?.actorName ?? full?.actorType} at ${full?.occurredAt}; PATCH ${patch.s} DELETE ${del.s}; edit/delete buttons in UI ${ctrls}`,
    );
  }
  {
    const dO = (await owner.get('/api/v1/dashboard/overview')).j;
    const dU = (await user.get('/api/v1/dashboard/overview')).j;
    const leads = ((await owner.get('/api/v1/leads?view=all&limit=100')).j.items ?? []) as J[];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: dO.timezone }).format(new Date());
    const nToday = leads.filter(
      (l) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: dO.timezone }).format(new Date(l.createdAt)) === today,
    ).length;
    const waiting = leads.filter((l) => l.status === 'open' && l.ackStatus === 'pending').length;
    ok(
      '4b Dashboard figures match records',
      dO.newLeadsToday.value === nToday && dO.attention.waitingAck === waiting,
      `newLeadsToday ${dO.newLeadsToday.value} vs ${nToday} leads; waitingAck ${dO.attention.waitingAck} vs ${waiting} pending`,
    );
    ok(
      '4c Dashboard differs by role',
      dO.scope !== dU.scope && dO.newLeadsToday.value !== dU.newLeadsToday.value,
      `owner scope=${dO.scope} newLeads=${dO.newLeadsToday.value}; user scope=${dU.scope} newLeads=${dU.newLeadsToday.value}`,
    );
  }

  // ── 5–8. Integrations evidence ─────────────────────────────────────
  {
    const cards = ((await owner.get('/api/v1/integrations')).j.cards ?? []) as J[];
    const st = (p: string) => cards.find((c) => c.provider === p)?.status;
    const ev = ((await owner.get('/api/v1/integration-events?limit=100')).j.events ?? []) as J[];
    const count = (p: string) => ev.filter((e) => e.provider === p).length;
    const pay = (await owner.get('/api/v1/payments')).j;
    const paid = ((pay.requests ?? []) as J[]).filter((r) => r.status === 'paid').length;
    ok(
      '5 WhatsApp: Meta connected + webhook events',
      st('meta_whatsapp') === 'connected' && count('meta_whatsapp') > 0,
      `card ${st('meta_whatsapp')}; meta events ${count('meta_whatsapp')} (live phone round-trip needs a human)`,
    );
    ok(
      '6 Stripe: a paid request on /payments',
      paid > 0,
      `card ${st('stripe')}; payment requests ${(pay.requests ?? []).length}, paid ${paid}; stripe events ${count('stripe')}`,
    );
    ok(
      '8 Slack: an alert was sent',
      ev.some((e) => e.provider === 'slack' && e.direction === 'out' && e.status === 'processed'),
      `card ${st('slack')}; outbound processed slack events ${ev.filter((e) => e.provider === 'slack' && e.status === 'processed').length}`,
    );
    const cal = (await owner.get('/api/v1/calendar/connection')).j;
    await page.goto(`${BASE}/en/appointments`);
    rec(
      '7 Calendar: connect state shown',
      cal.status === 'connected' ? 'PASS' : 'HUMAN',
      `calendar connection ${cal.status}; Google OAuth sign-in must be done by a human`,
    );
  }

  // ── 9. Quality: phone width, feedback, health ──────────────────────
  {
    const pages = [
      '',
      'leads',
      'inbox',
      'contacts',
      'companies',
      'pipeline',
      'payments',
      'appointments',
      'recovery',
      'team',
      'team/roles',
      'audit',
      'automations',
      'settings',
      'settings/fields',
      'settings/pipelines',
      'settings/integrations',
      'me',
    ];
    const phone = await b.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    await phone.addCookies(cookiesFor(owner));
    const pp = await phone.newPage();
    const wide: string[] = [];
    for (const p of pages) {
      await pp.goto(`${BASE}/en/${p}`, { waitUntil: 'networkidle' }).catch(() => undefined);
      const sw = (await pp.evaluate('document.documentElement.scrollWidth')) as unknown as number;
      await pp.screenshot({
        path: join(OUT, `phone-${p.replace(/\//g, '_') || 'home'}.png`),
        fullPage: true,
      });
      if (sw > 376) wide.push(`${p || '/'}=${sw}px`);
    }
    ok(
      '9a Every main page at 375px without horizontal scroll',
      wide.length === 0,
      wide.length
        ? `overflow: ${wide.join(', ')}`
        : `${pages.length} pages, screenshots in reports/selfcheck/`,
    );
    const lc = await b.newContext();
    const lg = await lc.newPage();
    await lg.goto(`${BASE}/en/login`);
    await lg.getByLabel(/email/i).fill(`nobody-${stamp}@example.test`);
    await lg.getByLabel(/password/i).fill('wrong-password-123');
    await lg.getByRole('button', { name: /sign in|log in/i }).click();
    await lg.waitForTimeout(4000);
    await lg.screenshot({ path: join(OUT, 'login-error.png') });
    const err = await lg
      .locator('[role=alert], [aria-live], [data-sonner-toast], [aria-invalid=true] ~ *')
      .allInnerTexts()
      .then((t) => t.join(' ').trim());
    ok('9b Actions show clear errors (bad login)', err.length > 0, `alert text "${err.slice(0, 80)}"`);
    const h = await anon.get('/api/health');
    ok('9c /api/health ok', h.s === 200 && h.j.ok === true, `${h.s} db=${h.j.db} version=${h.j.version}`);
  }
  await b.close();
}

main()
  .catch((e) => rec('runner', 'FAIL', (e as Error).stack?.split('\n').slice(0, 3).join(' ') ?? String(e)))
  .finally(() => {
    writeFileSync(
      join(OUT, 'results.json'),
      JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2),
    );
    const n = (s: Status) => results.filter((r) => r.status === s).length;
    console.log(
      `\n${n('PASS')} pass, ${n('FAIL')} fail, ${n('HUMAN')} need a human -> reports/selfcheck/results.json`,
    );
    process.exitCode = n('FAIL') ? 1 : 0;
  });
