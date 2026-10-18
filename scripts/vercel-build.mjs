// Vercel build entry (apps/web/vercel.json -> `pnpm run vercel-build`). Plain Node, no TS runner.
//
//   1. Migrations: only when VERCEL_ENV is production|preview AND DATABASE_URL_UNPOOLED is set.
//      They run as the OWNER over the direct (unpooled) Neon connection. On preview deploys the
//      Neon-Vercel integration points DATABASE_URL_UNPOOLED at that preview's own Neon branch.
//   2. `next build`. It never touches the database (config is parsed lazily; instrumentation skips
//      NEXT_PHASE=phase-production-build), so it also works with no DB env vars at all.
// A failed migration fails the build, so a broken migration never goes live. T-004 [Q18]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(repoRoot, 'apps', 'web');
const env = process.env;

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', env, shell: false });
  if (res.status !== 0) {
    console.error(`vercel-build: \`${cmd} ${args.join(' ')}\` failed (exit ${res.status ?? res.signal})`);
    process.exit(res.status ?? 1);
  }
}

const vercelEnv = env.VERCEL_ENV ?? '';
const deployed = ['production', 'preview'].includes(vercelEnv);
const hasUnpooled = Boolean(env.DATABASE_URL_UNPOOLED && env.DATABASE_URL_UNPOOLED.trim() !== '');

if (deployed && hasUnpooled) {
  console.log(`vercel-build: VERCEL_ENV=${vercelEnv} -> running migrations (owner, unpooled)`);
  run('pnpm', ['--filter', '@relay/db', 'migrate'], repoRoot);
} else if (deployed) {
  console.warn(
    `vercel-build: WARNING VERCEL_ENV=${vercelEnv} but DATABASE_URL_UNPOOLED is not set; migrations SKIPPED. ` +
      'Connect the Neon integration (docs/12-demo-and-ops.md section 4).',
  );
} else {
  console.log(`vercel-build: VERCEL_ENV=${vercelEnv || '(unset)'} -> migrations skipped`);
}

run('pnpm', ['exec', 'next', 'build'], webDir);
