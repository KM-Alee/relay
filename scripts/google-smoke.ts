// Manual REAL check against Google through the app's adapter (not the fake):
//   pnpm tsx scripts/google-smoke.ts [redirectUri]
// Builds the real consent URL with the app's OAuth client and asks Google to render it: a valid client + registered
// redirect URI answers 200 with the sign-in page; `invalid_client` / `redirect_uri_mismatch` show up in the body/status.
// Full consent needs a human (open the printed URL). Credentials come from the env files and are never printed.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

for (const f of ['apps/web/.env.local', '.env.secrets.local', '.env.local']) {
  if (existsSync(f)) process.loadEnvFile(f);
}
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.log(
    JSON.stringify({ ok: false, reason: 'GOOGLE_CLIENT_ID/SECRET not available in this environment' }),
  );
  process.exit(2);
}
const { createGoogleAdapter } = await import('../packages/core/src/integrations/google/adapter');
const redirectUri =
  process.argv[2] ??
  process.env.GOOGLE_REDIRECT_URI ??
  `http://localhost:${process.env.PORT ?? 3000}/api/integrations/google/callback`;
const verifier = randomBytes(48).toString('base64url');
const url = createGoogleAdapter().authUrl({
  state: randomBytes(16).toString('base64url'),
  codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
  redirectUri,
});
const res = await fetch(url, { redirect: 'manual' });
const loc = res.headers.get('location') ?? '';
const body = res.status === 200 ? await res.text() : '';
const verdict =
  res.status >= 300 &&
  res.status < 400 &&
  /accounts\.google\.com\/(v3\/signin|ServiceLogin|signin)/i.test(loc)
    ? 'accepted (redirects to Google sign-in)'
    : res.status === 200 && !/invalid_client|redirect_uri_mismatch/i.test(body)
      ? 'accepted (consent page rendered)'
      : /redirect_uri_mismatch/i.test(body + loc)
        ? 'redirect_uri_mismatch: add this redirect URI to the OAuth client'
        : /invalid_client/i.test(body + loc)
          ? 'invalid_client'
          : `unexpected (status ${res.status})`;
console.log(JSON.stringify({ httpStatus: res.status, verdict, redirectUri }));
// The consent URL contains only the public client id, a random state and a PKCE challenge: safe to share.
console.log(url);

// A bogus refresh token must come back as the 'auth' kind (invalid_grant) so the app flips to needs_reconnect (I3.2).
try {
  await createGoogleAdapter().refresh('1//bogus-refresh-token');
  console.log(JSON.stringify({ refreshProbe: 'unexpected success' }));
} catch (err) {
  const e = err as { kind?: string; code?: string };
  console.log(JSON.stringify({ refreshProbe: { kind: e.kind, code: e.code } }));
}
