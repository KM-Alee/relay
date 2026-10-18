#!/usr/bin/env node
// pnpm setup:env: create apps/web/.env.local from .env.example for local dev (README quickstart).
//  - generates the two required secrets (APP_ENCRYPTION_KEY, SESSION_SECRET) with node:crypto
//  - keyless local mode: INTEGRATIONS_FAKE=1 (fake WhatsApp/Stripe/Google/Slack adapters), AI_ENABLED=false
// Never overwrites an existing .env.local. Add real provider keys by hand afterwards (docs/12-demo-and-ops.md).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/web/.env.local');
if (existsSync(target)) {
  console.log('apps/web/.env.local already exists: left untouched.');
  process.exit(0);
}
const set = (text, key, value) => text.replace(new RegExp(`^${key}=.*$`, 'm'), () => `${key}=${value}`);
let env = readFileSync(join(root, '.env.example'), 'utf8');
env = set(env, 'APP_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
env = set(env, 'SESSION_SECRET', randomBytes(32).toString('base64'));
env = set(env, 'INTEGRATIONS_FAKE', '1');
env = set(env, 'AI_ENABLED', 'false');
writeFileSync(target, env, { mode: 0o600 });
console.log('Wrote apps/web/.env.local (fake providers, AI off). Edit it to use real provider keys.');
