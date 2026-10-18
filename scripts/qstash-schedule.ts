// pnpm qstash:schedule [--every 10m|1m | --cron "<expr>"] [--dry-run]
// Creates or updates (fixed scheduleId `relay-tick-backstop`) the QStash cron backstop that
// POSTs {PUBLIC_BASE_URL}/api/internal/tick with body {"trigger":"cron"} (12 §4, ADR-0002).
// Default every 10 min (144 msgs/day); `--every 1m` on demo day.
// Env: QSTASH_TOKEN, QSTASH_URL (region endpoint), PUBLIC_BASE_URL (from the shell, or apps/web/.env.local).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const envFile = path.resolve(import.meta.dirname, '../apps/web/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: {
    every: { type: 'string', default: '10m' },
    cron: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const EVERY: Record<string, string> = {
  '1m': '* * * * *',
  '5m': '*/5 * * * *',
  '10m': '*/10 * * * *',
  '15m': '*/15 * * * *',
};

function fail(msg: string): never {
  console.error(`[qstash:schedule] ${msg}`);
  process.exit(1);
}

const cron = values.cron ?? EVERY[values.every ?? '10m'];
if (!cron) fail(`--every must be one of ${Object.keys(EVERY).join(', ')} (or pass --cron "<expr>")`);
if (cron.trim().split(/\s+/).length !== 5) fail(`not a 5-field cron expression: "${cron}"`);

const { BACKSTOP_SCHEDULE_ID, isPubliclyReachable, tickUrl, upsertBackstopSchedule } =
  await import('../packages/core/src/integrations/qstash/index');

const base = process.env.PUBLIC_BASE_URL;
if (!base) fail('PUBLIC_BASE_URL is not set');
const destination = tickUrl(base);
if (!isPubliclyReachable(base) && !values.force) {
  fail(`${destination} is not reachable from QStash (localhost/private). Use the production URL or --force.`);
}

console.log(`[qstash:schedule] ${BACKSTOP_SCHEDULE_ID}: "${cron}" → POST ${destination}`);
if (values['dry-run']) process.exit(0);

const token = process.env.QSTASH_TOKEN;
if (!token) fail('QSTASH_TOKEN is not set');

try {
  const { scheduleId } = await upsertBackstopSchedule({
    token,
    baseUrl: process.env.QSTASH_URL || undefined,
    tickUrl: destination,
    cron,
  });
  console.log(`[qstash:schedule] ok: scheduleId=${scheduleId}`);
} catch (err) {
  fail(`QStash rejected the schedule: ${err instanceof Error ? err.message : String(err)}`);
}
