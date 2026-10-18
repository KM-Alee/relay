# 12 — Setup, Deployment, Operations and Demo Day

> **Status:** Accepted runbook. Keep it current: if you needed a step that isn't here, add it.
> Requirement anchors: Q13, Q18, I5.6, requirements §5 "Provider constraints", §8 demo checklist.

## 1. Accounts to create (all free / test mode)

| Service | Used for | Free-tier note (verify current limits) | Owner on team |
|---|---|---|---|
| GitHub | repo, CI, traceability re-run dispatch | free | _tbd_ |
| Vercel (Hobby) | hosting `apps/web` | cron only daily → we use QStash | _tbd_ |
| Neon (Free) | Postgres, branch per preview | scale-to-zero, compute-hour cap | _tbd_ |
| Upstash QStash | timer wake-ups + cron backstop schedule | daily message cap | _tbd_ |
| Vercel Blob | media storage | storage cap | _tbd_ |
| Meta for Developers | WhatsApp Cloud API test number | test recipients only (max ~5), 24 h window | _tbd_ |
| Stripe (test mode) | payments | account under a supported country (not PK) | _tbd_ |
| Google Cloud | Calendar API + OAuth (Testing status) | listed test users only | _tbd_ |
| Slack (free workspace) + Slack app | notifications (DM alerts, `/relay` command, Acknowledge button); separate dev app from its own manifest | free plan; recipients must be workspace members | _tbd_ |
| OpenAI | AI (only paid dependency) | set a hard monthly limit in the dashboard too | _tbd_ |

## 2. Environment variables

`.env.example` is the canonical list, validated by `packages/core/src/config.ts`: one Zod schema per group (section), parsed lazily on first use (`config.db.DATABASE_URL`), so a missing Stripe key never breaks the build or unrelated routes. Server boot (`apps/web/instrumentation.ts`) runs `validateConfig(['core', 'db'])` and fails with one message listing every missing/invalid variable (names only, never values). Empty values count as unset. Groups:

| Group | Vars |
|---|---|
| Core | `NODE_ENV`, `PUBLIC_BASE_URL`, `APP_ENCRYPTION_KEY` (32-byte base64), `SESSION_SECRET`, `DEMO_MODE` |
| Database | `DATABASE_URL` (pooled, **role `app_user`**), `DATABASE_URL_UNPOOLED` (owner, migrations only), `APP_DB_PASSWORD` (sets the `app_user` password in the roles migration) |
| Jobs | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `CRON_SECRET`, `TICK_BUDGET_MS` |
| Storage | `BLOB_READ_WRITE_TOKEN` |
| WhatsApp (platform default, can be overridden per workspace) | `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_GRAPH_VERSION` |
| Stripe | `STRIPE_SECRET_KEY` (sk_test_…), `STRIPE_WEBHOOK_SECRET` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_ID`, `SLACK_TEAM_ID` (optional) |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL_CHAT`, `OPENAI_MODEL_TRIAGE`, `OPENAI_MODEL_TRANSCRIBE`, `AI_ENABLED` (global kill switch), `AI_DEFAULT_DAILY_COST_CAP_USD` |
| Testing only | `INTEGRATIONS_FAKE` (`1` = fake adapters; boot refuses it in production) |
| CI / traceability | `GITHUB_TOKEN` (fine-grained PAT, `actions:write`), `GITHUB_REPO`, `GITHUB_REF`, `TEST_RESULTS_URL`, `TEST_RESULTS_SECRET`; CI-only: `NEON_API_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET` |

Vercel scopes: production secrets → *Production*; dev bot/app secrets → *Development* and *Preview*. Never share the production Meta app secret with Preview.

## 3. Local development

```bash
pnpm i
cp .env.example apps/web/.env.local     # or: vercel env pull apps/web/.env.local
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev                                 # Next.js + dev ticker (runs runDueWork every 1 s)
```
- Docker Postgres 16 (`docker-compose.yml`): owner `postgres/postgres`, databases `relay` + `relay_test`; `docker/postgres/init/01-relay.sql` creates the `app_user` LOGIN role with the dev password (first start only). Fill `APP_ENCRYPTION_KEY` / `SESSION_SECRET` in `.env.local` with `openssl rand -base64 32`.
- `pnpm test` needs the DB up. The integration setup takes the DB **name** from `TEST_DATABASE_URL` (owner credentials from `TEST_DATABASE_URL_UNPOOLED`), creates it if missing and runs all migrations, so per-worktree DBs (`relay_test_t124`) just work. It refuses non-local hosts unless `ALLOW_REMOTE_TEST_DB=1`.
- `pnpm db:reset` drops + recreates + migrates the local DB (refuses non-local hosts). `pnpm db:migrate --test` migrates the test DB by hand.
Webhooks locally (use **dev** credentials only):
- Stripe: `stripe listen --forward-to localhost:3000/api/webhooks/stripe/<connectionKey>`
- Slack / Meta: `cloudflared tunnel --url http://localhost:3000`, then point the dev Slack app's request URLs (from its manifest) / dev Meta app webhook at that URL.
- Without a tunnel, run adapter contract tests with recorded fixtures (`08-testing.md`).

## 4. First-time production setup (once, in order)

1. **Neon**: create the project in **AWS ap-southeast-1**. Install the Neon↔Vercel integration (it creates preview branches and sets `DATABASE_URL*`). Then **override `DATABASE_URL` to use the `app_user` role** (created by the roles migration with `APP_DB_PASSWORD`). The owner role bypasses RLS and must never serve requests.
2. **Vercel**: import the repo, set root `apps/web`, region `sin1` (in `vercel.json`), Fluid compute on, add env vars, deploy. Check `/api/health`.
3. **QStash**: copy the token + signing keys into env. Nothing to configure in the dashboard; we schedule messages from code.
4. **QStash schedule** (backstop): in the QStash console (or `pnpm qstash:schedule`), create a schedule `*/10 * * * *` → `POST https://<prod>/api/internal/tick`. Switch it to `* * * * *` on demo day.
5. **Meta**: create an app with the WhatsApp product. Note the test number, `phone_number_id` and WABA ID. Generate a token (prefer a **System User permanent token**; temporary tokens expire in about 24 h). Webhook URL = `https://<prod>/api/webhooks/meta/<connectionKey>` with the verify token. Subscribe to `messages`. Add test recipients. Create and submit the templates needed outside the 24 h window (e.g. `booking_confirmation`, `payment_link`) in `en` and `ur`.
6. **Stripe** (test mode): webhook endpoint `https://<prod>/api/webhooks/stripe/<connectionKey>` with events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `charge.refunded` (final list in `04-integrations.md`).
7. **Google**: enable the Calendar API, set up the OAuth consent screen (External, **Testing**), add every teammate + judge account as a test user, set the redirect URI `https://<prod>/api/integrations/google/callback`.
8. **Slack**: create a free Slack workspace and invite teammates (and judges, if they should see alerts live). Run `pnpm slack:manifest` (prints `apps/web/slack/manifest.json` with `PUBLIC_BASE_URL` filled in) → api.slack.com/apps → **Create app from manifest** → paste → install to the workspace → copy the **bot token** (`xoxb-…`) and **signing secret** (plus App ID / Team ID) into env. The manifest sets the `/relay` command URL `https://<prod>/api/webhooks/slack/<connectionKey>/commands` and the interactivity URL `…/interactions`. Use a separate app for dev. Verify current Slack setup details at build time.
9. **OpenAI**: set the key + a monthly hard limit in the OpenAI dashboard. Confirm the current cheapest suitable models and set the `OPENAI_MODEL_*` vars.
10. `pnpm db:seed` against production **only in demo mode** (or use the in-app "Reset demo workspace").

## 5. Operations

- **Health**: the integrations page (I5.1) shows each provider's status, last OK and recent errors. `job_runs` shows the last tick and its trigger. If the last tick is older than 2× the backstop interval, the page shows a warning.
- **Stuck timers**: run `POST /api/internal/tick` with the cron secret, or `pnpm tsx scripts/dev-ticker.ts` pointed at prod (it calls `runDueWork` directly).
- **Missed webhooks after an outage**: re-send from the provider dashboard (Stripe/Meta) or use event replay (I5.9). Idempotency makes either safe.
- **Neon cold start**: the first request after idle takes ~0.5 s extra. On demo day, switch the backstop schedule to every minute an hour beforehand.
- **Secret rotation**: update the Vercel env → redeploy. For per-workspace secrets, reconnect on the integrations page.
- **`APP_ENCRYPTION_KEY` rotation** (06 §5): set `APP_ENCRYPTION_KEY_PREVIOUS` = the old key and `APP_ENCRYPTION_KEY` = a new one (`openssl rand -base64 32`) → redeploy. Envelopes carry the key id (`v1.<keyId>.<…>`), so old rows still decrypt; re-encrypt every row where `secrets.needsReencrypt()` is true (re-encrypt script: owner of `integration_connections`, Lane C), then drop `_PREVIOUS`.

## 6. Demo day checklist (extends requirements §8)

T-24 h
- [ ] Production deploy frozen (tag `demo-v1`). Only fixes via PR with a green CI.
- [ ] Judges' and teammates' WhatsApp numbers added as Meta test recipients. Slide has a QR code / `wa.me` link to the test number.
- [ ] Meta token is permanent (System User), or freshly generated if temporary.
- [ ] All teammates are in the Slack workspace and have **Connect Slack** done (`/relay link <code>`), with Slack mobile notifications on for the app's DMs; Google test users added and **tokens freshly connected** (Testing-mode refresh tokens can expire).
- [ ] Stripe webhook points at prod; test card `4242 4242 4242 4242` ready.
- [ ] OpenAI cap well above demo needs; the Urdu/English fallback auto-reply verified by switching AI off.
- [ ] Backup screen recording of the full 5-minute flow.

T-1 h
- [ ] QStash backstop schedule set to every minute. `job_runs` shows recent ticks from both wake-ups and the schedule.
- [ ] Time-warp set to the demo speed. Demo workspaces reset (`Reset demo workspace` in Judge Console).
- [ ] Send one WhatsApp message end-to-end and pay one test checkout to warm everything.
- [ ] Phones: Slack mobile app installed, signed in, notifications on, Do Not Disturb off, battery charged. Laptop: sound cues on/off as planned.

Fallbacks during the demo
- WhatsApp slow or down → use the public web form intake (same engine) and say so.
- Venue network down → hotspot, then the screen recording.
- AI slow → the static fallback reply proves F6.11 live ("this is the failure isolation working").
