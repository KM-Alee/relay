// Runtime connection string (06 §3). Pure: no I/O, safe to import from config.
//
// The Neon<->Vercel integration sets DATABASE_URL to the OWNER role (and injects branch-specific values
// on previews that override manual edits). The owner bypasses RLS, so the runtime pool never uses it
// as is: when APP_DB_PASSWORD is set and the URL's user is not `app_user`, we rewrite username and
// password to app_user / APP_DB_PASSWORD and keep host, database and params. Migrations use
// DATABASE_URL_UNPOOLED as the owner and are unaffected.
export const APP_ROLE = 'app_user';

export function runtimeDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return undefined;
  const password = env.APP_DB_PASSWORD?.trim();
  if (!password) return raw;
  const url = new URL(raw);
  if (decodeURIComponent(url.username) === APP_ROLE) return raw;
  url.username = APP_ROLE;
  url.password = password; // URL setter percent-encodes
  return url.toString();
}
