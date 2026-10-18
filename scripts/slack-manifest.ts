// pnpm slack:manifest [https://base.url]  -> prints apps/web/slack/manifest.json with PUBLIC_BASE_URL filled in.
// Paste it at api.slack.com/apps -> "Create New App" -> "From manifest" (or into the existing app's manifest tab).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(base)) {
  console.error(
    'Set PUBLIC_BASE_URL (or pass it as an argument): must be an https:// origin, e.g. https://relay.vercel.app',
  );
  process.exit(1);
}
const file = path.resolve(import.meta.dirname, '../apps/web/slack/manifest.json');
process.stdout.write(readFileSync(file, 'utf8').replaceAll('{{PUBLIC_BASE_URL}}', base));
