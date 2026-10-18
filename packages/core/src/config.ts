// Environment configuration (docs/01-architecture.md §8, Q13). Canonical list: /.env.example.
//
// Design:
// - One Zod schema PER SECTION. Lanes add vars to their own section only (additive edits).
// - Sections are parsed LAZILY on first access (`config.db`, `config.ai`, …) and cached, so
//   `next build` or an unrelated route never fails because, say, Stripe isn't configured.
// - `validateConfig([...])` is the fail-fast boot check (instrumentation / scripts). It parses the
//   listed sections and throws ONE error listing every missing/invalid variable.
// - Empty strings count as "not set" (.env.example ships `KEY=` placeholders).
// - Values are never included in error messages (they may be secrets); only variable names.
import { runtimeDatabaseUrl } from '@relay/db/runtime-url';
import { z } from 'zod';

type Env = Record<string, string | undefined>;

// ── helpers ──────────────────────────────────────────────────────────────
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
/** Optional string; '' → undefined. */
const optStr = () => z.preprocess(blankToUndefined, z.string().optional());
/** String with a default; '' → default. */
const strDef = (def: string) => z.preprocess((v) => blankToUndefined(v) ?? def, z.string());
const url = () => z.preprocess(blankToUndefined, z.url({ error: 'must be a URL' }));
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (blankToUndefined(v) === undefined ? def : v),
    z.union([z.boolean(), z.enum(['true', 'false', '1', '0']).transform((s) => s === 'true' || s === '1')]),
  );
const int = (def: number) =>
  z.preprocess((v) => (blankToUndefined(v) === undefined ? def : v), z.coerce.number().int().positive());
const num = (def: number) =>
  z.preprocess((v) => (blankToUndefined(v) === undefined ? def : v), z.coerce.number().nonnegative());
/** base64 that decodes to at least `bytes` bytes. */
const base64Key = (bytes: number, exact = false) =>
  z.preprocess(
    blankToUndefined,
    z.string({ error: 'is required' }).refine(
      (s) => {
        const n = Buffer.from(s, 'base64').length;
        return exact ? n === bytes : n >= bytes;
      },
      {
        error: `must be base64 of ${exact ? 'exactly' : 'at least'} ${bytes} bytes (openssl rand -base64 ${bytes})`,
      },
    ),
  );
/** Treat a bare prefix placeholder (`sk_test_`, `whsec_`) as "not set". */
const prefixed = (prefix: string, msg: string) =>
  z.preprocess(
    (v) => (blankToUndefined(v) === undefined || v === prefix ? undefined : v),
    z.string().startsWith(prefix, { error: msg }).optional(),
  );

// ── sections (add your vars to YOUR lane's section) ───────────────────────
export const sections = {
  // W0 / all lanes
  core: z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PUBLIC_BASE_URL: url(),
    APP_ENCRYPTION_KEY: base64Key(32, true),
    APP_ENCRYPTION_KEY_PREVIOUS: z.preprocess(blankToUndefined, base64Key(32, true).optional()),
    SESSION_SECRET: base64Key(32),
    DEMO_MODE: bool(false),
  }),

  // W0 / T-002. Runtime = pooled app_user URL. The UNPOOLED owner URL is for migrations only.
  db: z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      DATABASE_URL: url(),
      DATABASE_URL_UNPOOLED: z.preprocess(blankToUndefined, z.url().optional()),
      APP_DB_PASSWORD: optStr(),
    })
    .superRefine((v, ctx) => {
      // 06 §3: the app must never serve requests as the owner (owner bypasses RLS). Tests create roles.
      // The runtime pool rewrites an owner URL to app_user when APP_DB_PASSWORD is set (db/runtime-url.ts).
      const effective = runtimeDatabaseUrl({
        DATABASE_URL: v.DATABASE_URL,
        APP_DB_PASSWORD: v.APP_DB_PASSWORD,
      });
      if (v.NODE_ENV !== 'test' && new URL(effective ?? v.DATABASE_URL).username !== 'app_user') {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'must connect as role app_user (or set APP_DB_PASSWORD so the runtime rewrites it)',
        });
      }
    }),

  // Lane A / T-008: jobs, timers, wake-ups
  jobs: z.object({
    QSTASH_TOKEN: optStr(),
    // Region-specific QStash API endpoint shown in the Upstash console (default: SDK global URL).
    QSTASH_URL: z.preprocess(blankToUndefined, z.url().optional()),
    QSTASH_CURRENT_SIGNING_KEY: optStr(),
    QSTASH_NEXT_SIGNING_KEY: optStr(),
    CRON_SECRET: optStr(),
    TICK_BUDGET_MS: int(20_000),
  }),

  // Lane C: storage
  storage: z.object({
    BLOB_READ_WRITE_TOKEN: optStr(),
  }),

  // Lane C / T-141: WhatsApp (Meta Cloud API) platform defaults; workspaces may override
  whatsapp: z.object({
    META_APP_ID: optStr(),
    META_APP_SECRET: optStr(),
    META_VERIFY_TOKEN: optStr(),
    META_WABA_ID: optStr(),
    META_PHONE_NUMBER_ID: optStr(),
    META_ACCESS_TOKEN: optStr(),
    META_GRAPH_VERSION: optStr(),
  }),

  // Lane C / T-143: Stripe, TEST MODE ONLY
  stripe: z.object({
    STRIPE_SECRET_KEY: prefixed('sk_test_', 'must be a TEST key (sk_test_…)'),
    STRIPE_WEBHOOK_SECRET: prefixed('whsec_', 'must start with whsec_'),
  }),

  // Lane C / T-144: Google Calendar OAuth
  google: z.object({
    GOOGLE_CLIENT_ID: optStr(),
    GOOGLE_CLIENT_SECRET: optStr(),
    GOOGLE_REDIRECT_URI: z.preprocess(blankToUndefined, z.url().optional()),
  }),

  // Lane C / T-145: notifications via Slack (ADR-0011)
  notifications: z.object({
    SLACK_BOT_TOKEN: optStr(),
    SLACK_SIGNING_SECRET: optStr(),
    SLACK_APP_ID: optStr(),
    SLACK_TEAM_ID: optStr(), // optional: restricts the app to one Slack workspace
  }),

  // Lane C2 / T-204: OpenAI (only paid dependency). AI_ENABLED=false → app fully works.
  ai: z
    .object({
      AI_ENABLED: bool(false),
      INTEGRATIONS_FAKE: bool(false),
      OPENAI_API_KEY: optStr(),
      // Defaults verified 2026-10-18 (developers.openai.com/api/docs/pricing); override via env.
      OPENAI_MODEL_CHAT: strDef('gpt-4.1-mini'),
      OPENAI_MODEL_TRIAGE: strDef('gpt-4.1-nano'),
      OPENAI_MODEL_TRANSCRIBE: strDef('gpt-4o-mini-transcribe'),
      AI_DEFAULT_DAILY_COST_CAP_USD: num(2),
    })
    .superRefine((v, ctx) => {
      if (v.AI_ENABLED && !v.INTEGRATIONS_FAKE && !v.OPENAI_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['OPENAI_API_KEY'],
          message: 'is required when AI_ENABLED=true (or set AI_ENABLED=false)',
        });
      }
    }),

  // Lane Q / C: testing, CI, traceability
  testing: z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      INTEGRATIONS_FAKE: bool(false),
      GITHUB_TOKEN: optStr(),
      GITHUB_REPO: optStr(),
      GITHUB_REF: z.preprocess(blankToUndefined, z.string().default('main')),
      TEST_RESULTS_URL: z.preprocess(blankToUndefined, z.url().optional()),
      TEST_RESULTS_SECRET: optStr(),
    })
    .superRefine((v, ctx) => {
      // 13 §5: fake adapters are refused in production.
      if (v.NODE_ENV === 'production' && v.INTEGRATIONS_FAKE) {
        ctx.addIssue({
          code: 'custom',
          path: ['INTEGRATIONS_FAKE'],
          message: 'must not be enabled in production',
        });
      }
    }),
} as const;

export type Sections = typeof sections;
export type SectionName = keyof Sections;
export type Config = { [K in SectionName]: z.output<Sections[K]> };

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'See .env.example and docs/12-demo-and-ops.md §2.',
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function describeIssues(section: string, error: z.ZodError, env: Env): string[] {
  return error.issues.map((i) => {
    const key = i.path.join('.') || '(section)';
    const missing = blankToUndefined(env[key]) === undefined && i.code !== 'custom';
    return `${key} ${missing ? 'is required' : i.message} [${section}]`;
  });
}

function parseSection<K extends SectionName>(name: K, env: Env): Config[K] {
  const res = sections[name].safeParse(env);
  if (!res.success) throw new ConfigError(describeIssues(name, res.error, env));
  return res.data as Config[K];
}

/** Build a lazily-parsed config over `env` (default: process.env). Each section parses once. */
export function createConfig(env: Env = process.env): Config {
  const cache = new Map<SectionName, unknown>();
  const out = {} as Config;
  for (const name of Object.keys(sections) as SectionName[]) {
    Object.defineProperty(out, name, {
      enumerable: true,
      get() {
        if (!cache.has(name)) cache.set(name, parseSection(name, env));
        return cache.get(name);
      },
    });
  }
  return out;
}

/** Fail fast: parse `names` (default: all) and throw ONE ConfigError listing every problem. */
export function validateConfig(
  names: readonly SectionName[] = Object.keys(sections) as SectionName[],
  env: Env = process.env,
): void {
  const problems: string[] = [];
  for (const name of names) {
    const res = sections[name].safeParse(env);
    if (!res.success) problems.push(...describeIssues(name, res.error, env));
  }
  if (problems.length) throw new ConfigError(problems);
}

/** The process-wide config. `config.core.PUBLIC_BASE_URL`, `config.db.DATABASE_URL`, … */
export const config: Config = createConfig();
