// Local dev ticker (13 §5, 01 §6): calls runDueWork({ trigger: 'dev' }) about once a second, so
// timers and the outbox work locally without QStash. Started by `pnpm dev` (alongside Next) or alone
// with `pnpm dev:ticker`. Not a business timer: deadlines live in Postgres; this only polls.
//
// Env: apps/web/.env.local (same DB as the dev server). DEV_TICKER_INTERVAL_MS (default 1000).
// Refuses to run with NODE_ENV=production.
import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '../apps/web/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

if (process.env.NODE_ENV === 'production') {
  console.error('[dev-ticker] refusing to run with NODE_ENV=production');
  process.exit(1);
}

const intervalMs = Math.max(200, Number(process.env.DEV_TICKER_INTERVAL_MS) || 1000);
const ERROR_BACKOFF_MS = 5000;

// Imported after the env file is loaded (the DB pool reads DATABASE_URL on first use).
const { runDueWork } = await import('../packages/core/src/jobs/run-due-work');
const { closeDb } = await import('../packages/db/src/index');

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await closeDb().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

console.log(`[dev-ticker] running due work every ${intervalMs} ms (trigger=dev)`);
let lastError = '';
while (!stopping) {
  try {
    const r = await runDueWork({ trigger: 'dev', budgetMs: 5000 });
    lastError = '';
    const errors = Object.entries(r.processors).filter(([, p]) => p.error);
    if (r.outboxProcessed || r.leadsProcessed || errors.length) {
      console.log(
        `[dev-ticker] outbox=${r.outboxProcessed} leads=${r.leadsProcessed} ${r.durationMs}ms` +
          (errors.length ? ` errors=${errors.map(([n, p]) => `${n}: ${p.error}`).join('; ')}` : ''),
      );
    }
    await sleep(intervalMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // e.g. DB down or not migrated yet: say it once, keep retrying quietly.
    if (msg !== lastError)
      console.error(`[dev-ticker] tick failed: ${msg} (retrying every ${ERROR_BACKOFF_MS} ms)`);
    lastError = msg;
    await sleep(ERROR_BACKOFF_MS);
  }
}
