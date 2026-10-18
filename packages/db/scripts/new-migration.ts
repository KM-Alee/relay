// pnpm db:new <lane> <slug>  → packages/db/migrations/<YYYYMMDDHHmm>_<lane>_<slug>.sql (UTC)
// Lanes: a b c c1 c2 d q w0. Never edit a merged migration; add a new one (13 §3).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATION_FILE_RE, MIGRATIONS_DIR } from '../src/migrate';

const LANES = ['a', 'b', 'c', 'c1', 'c2', 'd', 'q', 'w0'];
const [laneArg, ...slugParts] = process.argv.slice(2).filter((a) => a !== '--');
const lane = (laneArg ?? '').toLowerCase();
const slug = slugParts
  .join('_')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');
if (!LANES.includes(lane) || !slug) {
  console.error(`usage: pnpm db:new <lane: ${LANES.join('|')}> <slug>   e.g. pnpm db:new b contacts`);
  process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;

// Keep filename order strictly after every existing migration (bump the minute on collision/skew).
const existing = readdirSync(MIGRATIONS_DIR)
  .filter((f) => MIGRATION_FILE_RE.test(f))
  .sort();
const last = existing.at(-1)?.slice(0, 12) ?? '';
const t = new Date();
let ts = stamp(t);
while (ts <= last) {
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  ts = stamp(t);
}
const file = path.join(MIGRATIONS_DIR, `${ts}_${lane}_${slug}.sql`);
if (!MIGRATION_FILE_RE.test(path.basename(file)) || existsSync(file)) {
  console.error(`cannot create ${file}`);
  process.exit(1);
}
writeFileSync(
  file,
  `-- ${path.basename(file)}  (lane ${lane})
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
-- Rules: docs/02-data-model.md §0, docs/06-security.md §3 (RLS), template: packages/db/sql/templates/tenant-table.sql
--
-- Workspace-scoped table checklist:
--   workspace_id uuid NOT NULL REFERENCES workspaces (id), UNIQUE (workspace_id, id),
--   composite FKs to parents, version int for mutable aggregates, updated_at trigger (set_updated_at),
--   then: SELECT relay_enable_tenant_rls('<table>');            -- ENABLE + FORCE RLS + policy + grants
--         SELECT relay_enable_tenant_rls('<table>', 'SELECT, INSERT, UPDATE');  -- restricted grants
-- Global table (no workspace_id): GRANT only the minimum privileges to app_user.

`,
);
console.log(`created ${path.relative(path.resolve(MIGRATIONS_DIR, '../../..'), file)}`);
