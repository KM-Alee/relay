// Seed module contract (13 §3). Owner: Lane B (T-010 fills in demo data, T-211 demo workspaces).
// Seeds run as the OWNER role (DATABASE_URL_UNPOOLED) on local/preview DBs only and MUST be
// idempotent (upsert by fixed ids / ON CONFLICT DO NOTHING): `pnpm db:seed` may run many times.
import type { Db } from '../src/client';

export interface SeedContext {
  db: Db;
  log: (msg: string) => void;
}

export interface SeedModule {
  /** Domain name, e.g. 'identity'. Modules run in the order listed in seed/index.ts. */
  name: string;
  run: (ctx: SeedContext) => Promise<void>;
}
