// Loads local env for CLI scripts: <repo>/apps/web/.env.local (written by you or scripts/wt.sh).
// Already-set variables win (CI / Vercel provide env directly).
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
for (const file of ['apps/web/.env.local', '.env.local']) {
  const p = path.join(repoRoot, file);
  if (existsSync(p)) process.loadEnvFile(p);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to apps/web/.env.local (docs/12-demo-and-ops.md §2).`);
    process.exit(1);
  }
  return v;
}
