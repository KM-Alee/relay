# 15 — How Relay works (the 15-minute team explainer)

> Goal: after reading this, any teammate can explain to a judge (1) the data model, (2) how permissions are checked, (3) how escalation timing works, (4) how webhooks are handled. Paths are relative to the repo root. Specs: `02-data-model.md`, `06-security.md`, `03-lead-engine.md`, `04-integrations.md`, `01-architecture.md` §6.

## 0. The 30-second story

Relay is a WhatsApp-first CRM. A customer messages, a **lead** is created with **exactly one accountable owner**. If that person does not acknowledge in time, the lead **escalates** to the next person and an alert goes out (Slack). An AI stand-in can keep the customer warm but never counts as a response. Everything is one Next.js app on Vercel plus one Postgres (Neon). There is no separate worker: a "tick" (`runDueWork`) does all timed work, and Postgres stores every deadline.

## 1. Data model

One database, one set of tables, many **workspaces** (tenants). Every business table has `workspace_id`.

| Area | Main tables (`packages/db/migrations/*.sql`, Drizzle in `packages/db/src/schema/`) |
|---|---|
| Identity | `workspaces`, `users` (base level owner/admin/user), `roles`, `user_roles`, `level_permissions`, `user_permission_overrides`, `sessions`, `invites` |
| CRM | `contacts`, `companies`, `pipelines`, `stages`, `custom_fields` + `field_values`, `stage_required_fields`, `opportunities` (value in minor units), `tags`, `saved_lists`, `activities` (the timeline, append-only) |
| Leads | `leads` (one row per inbound opportunity to handle: `owner_user_id` NOT NULL, `ack_status`, `escalate_at`, `escalation_level`, `version`), `lead_events` (history), teams and escalation policies (Lane A, merging) |
| Messaging | `conversations` (one per customer phone), `messages` (in/out, status queued, sent, delivered, read, failed), `media`, `message_templates` |
| Payments / calendar | `payment_requests` (status pending, paid, expired, failed, refunded), `payments` (the money ledger: charges and refunds), `appointments`, `oauth_states` |
| Integrations / plumbing | `integration_connections` (encrypted secrets), `integration_events` (every webhook, idempotent), `outbox` (side-effect queue), `scheduler_state` and `job_runs` (tick bookkeeping), `realtime_events` (change feed), `rate_limits`, `audit_events` |

How they relate: contact 1—n opportunities, conversations, payment requests, appointments, activities. A lead points at a contact; the lead's owner is a user. **Contact 360** (`core/services/crm-contact360.ts`, providers in `core/services/contact360-providers.ts`) joins all of it for the "full history" page.

**Workspace isolation = Postgres Row-Level Security.** Every tenant table has `ENABLE + FORCE ROW LEVEL SECURITY` and a policy `workspace_id = current_setting('app.workspace_id')` (`relay_enable_tenant_rls()` in `202610181200_w0_roles.sql`). The app connects as `app_user` (cannot bypass RLS). All code reaches the DB through `withWorkspaceTx(workspaceId, fn)` (`packages/db/src/tx.ts`), which opens a transaction and runs `set_config('app.workspace_id', …, true)` (transaction-local, so it is safe behind Neon's pooler). Without that setting, queries return zero rows (fails closed). So even a coding mistake cannot leak another workspace's rows. `withSystemTx` has no workspace and is only for global tables and `SECURITY DEFINER` functions.

Audit: `audit_events` is append-only (triggers reject UPDATE/DELETE for every role) with a per-workspace hash chain; `audit.verify()` and the audit page detect tampering.

## 2. Permission checks (the five gates, in order)

Every API call walks the same path. The file to open is `apps/web/lib/http/route.ts`.

1. **`route({ auth, permission, body, handler })`**: checks CSRF on unsafe methods, resolves the session cookie to an **Actor** (`apps/web/lib/http/session.ts`, `core/auth/actor.ts`), runs rate limits, validates input with Zod. Unauthenticated gives 401.
2. **Actor** = `{ userId, workspaceId, baseLevel, permissions, locale }`. Permissions are **recomputed on every request** (`core/auth/effective-permissions.ts`): level defaults, plus roles, then per-user grants and denies (deny wins). Owner always has all. Changing a role in the UI takes effect on the next request.
3. **`assertPermission(actor, key)`** (`core/auth/permissions.ts`; keys in `packages/contracts/src/permissions.ts`) is called in the route **and again inside the service**, so a service can never be called without the check. Missing permission gives 403.
4. **Visibility scope** (`core/auth/visibility.ts`): without `leads.view_all` a user sees only their own leads and the contacts they own or have an open lead on, and the conversations, opportunities, payments and appointments of those contacts (`contactScopeSql`). Anything out of scope, or in another workspace, returns **404, not 403**, so existence never leaks (`foundOr404`).
5. **Masking** (`core/auth/mask.ts`): opportunity value is `{ masked: true }` unless the actor has `crm.opportunity.value.view`. Every output path goes through it: API DTOs, CSV export, dashboard, search, AI input, Slack. The browser never receives the number it should not see. Example: `payments.ts` `toDto` uses `maskMoney`.

Plus: the UI hides buttons by permission, but that is cosmetics; the server is the authority. Page access is gated server-side too (`requirePage` in `apps/web/lib/http/page-auth.ts`).

## 3. Escalation timing

Principle: **time lives in Postgres, not in memory.** A lead row stores `escalate_at` (when the acknowledgement window ends). No `setTimeout` anywhere for business deadlines. Durations come from `clock.deadline()` (`core/clock.ts`), which is how the Judge Console's **time-warp** speeds the demo up.

Life of a lead (full rules: `docs/03-lead-engine.md` §4–§6):

1. **Intake** (web form, WhatsApp message, manual entry): in one transaction the lead is inserted **with an owner already chosen** by routing (only *Available* employees with capacity; round robin), `ack_window_ends_at = escalate_at = now + window`. Nobody is ever "unassigned" in between.
2. The owner **acknowledges** by clicking Acknowledge, replying in Slack, or doing any human action (note, call, stage change). Ack clears `escalate_at`. AI replies never acknowledge.
3. If `escalate_at` passes while `ack_status = pending`, the timer processor **escalates**: lock the row, re-check it is still pending, pick the next person in the policy (level 1 next eligible, level 2, then team backup, then manager), set a fresh deadline for that level, write a `lead_events` row, enqueue the Slack alert to the new owner. The chain, levels and timeouts are configurable per team. End of chain marks the lead **critical** and alerts a custodian even if they are unavailable.
4. **Absence**: when a user goes On leave or Offline, their pending leads are re-routed in the *same transaction* as the status change, and the recovery queue shows why.

**Who runs the timers? `runDueWork()`** (`core/jobs/run-due-work.ts`), a stateless, idempotent function:
- It claims due rows with `SELECT … FOR UPDATE SKIP LOCKED`, processes a batch inside a time budget, then computes the **next earliest deadline** across processors.
- It asks **QStash** (Upstash) for **one wake-up** at that deadline (`core/jobs/scheduler.ts`: `ensureWakeBy` writes a `wake.schedule` outbox row in the same transaction that set the deadline, so it cannot be lost). QStash calls `POST /api/internal/tick` (signature verified).
- **Backstop**: a QStash cron (`pnpm qstash:schedule`, every few minutes) calls the same endpoint, and request handlers also "kick" a tick after they respond (`after()`). If a wake is lost, the cron catches it. If three callers fire at once, `SKIP LOCKED` plus the version check make them harmless.
- Locally, `pnpm dev` runs `scripts/dev-ticker.ts` (every second) instead of QStash.

**Why one escalation per timeout (F3.8):** each transition runs `SELECT … FOR UPDATE`, re-checks the guard, then does `UPDATE leads … WHERE id = $1 AND version = $v` and must hit exactly one row. Two ticks racing on the same lead: one gets the lock and the other skips or fails the version check. An ack racing an escalation: whichever commits first wins, the loser sees the changed state and does nothing (the Slack button replies "already handled"). A crash before commit rolls back and the next tick redoes it exactly once. **No external call inside the transaction**: Slack, WhatsApp, Stripe go to the `outbox` table in the same transaction and are sent by the outbox processor with retries, backoff and a dead-letter state (`core/jobs/outbox-processor.ts`, handlers in `core/jobs/handlers/`).

(The leads domain and timers are being merged by Lane A; the mechanics above are already in `core/jobs`, and `services/leads.ts` follows doc 03 §5.)

## 4. Webhook handling

Rule (AGENTS.md hard rule 6): **verify the signature on the raw body, record idempotently, answer 200, process from the outbox.** The shared pipeline is `core/services/integrations-ingest.ts`; routes are thin (`apps/web/app/api/webhooks/<provider>/[connectionKey]/route.ts`).

1. Read the **raw text body first** (before any JSON parsing).
2. Resolve the connection by key (a workspace's own secrets, or the platform default).
3. **Verify**: forged or stale requests are rejected (400) and *recorded* as `status = rejected`, throttled per IP.
4. **Record idempotently** in `integration_events` keyed by the provider's event id (`UNIQUE`), plus an outbox row in the same transaction. A duplicate delivery only increments `duplicate_count`.
5. **Return 200 fast**; processing happens after the response (`after()`) and, as a safety net, from the outbox. A failure never loses the event, and failed sends show a Retry button.

| Provider | Verification | What happens next |
|---|---|---|
| **Meta WhatsApp** (`core/integrations/meta`) | `X-Hub-Signature-256` = HMAC-SHA256 of the raw body with the app secret, constant-time compare; GET handshake checks the verify token | inbound messages create or find the conversation and contact, statuses update `messages.status`, inbound media is downloaded by a job; outbound uses the `whatsapp.send` outbox job; 24-hour window and opt-out are enforced in `messaging.send` |
| **Stripe** (`core/integrations/stripe`, `services/stripe-ingest.ts`) | `Stripe-Signature` (timestamped HMAC over the raw body, replay window) | `processStripeEvent` applies a **monotonic** status change (pending to paid, refunds, failures) plus a ledger row (`UNIQUE provider_ref + kind`, so a replay or a different event for the same charge cannot double-count), an audit entry, a timeline activity, and a realtime hint |
| **Slack** (`core/integrations/slack/signature.ts`) | `v0=` HMAC-SHA256 of `v0:{timestamp}:{raw body}` with the signing secret, constant-time, rejects timestamps more than 5 minutes off | button clicks (Acknowledge) call the same lead transition as the app; a stale click gets an explanation |
| **Google Calendar** (OAuth, not a webhook) | `/api/integrations/google/start` stores a single-use `oauth_states` row (state + PKCE); `/callback` validates it for the signed-in user, exchanges the code, stores **encrypted** tokens | appointments sync via the `calendar.*` outbox jobs; conflicts come from free/busy; a revoked grant flips the connection to "needs reconnect" |
| **QStash** | `Upstash-Signature` (current and next signing keys) on `/api/internal/tick` | runs `runDueWork` |

Secrets are AES-GCM encrypted at rest (`core/secrets.ts`, key from env), never logged, never sent to the browser. A provider outage opens a **circuit breaker** (`core/integrations/breaker.ts`); the rest of the app keeps working and the outbox retries.

## 5. Likely judge questions

**1. How do you stop one workspace seeing another's data?** RLS on every tenant table, enforced for the `app_user` role with no bypass. The workspace id is set transaction-locally by `withWorkspaceTx`; without it queries return nothing. On top of that, services scope by workspace and return 404 for foreign ids. There is a test suite that attacks this directly.

**2. A plain employee calls the API for an opportunity's value. What happens?** The route authenticates, the service checks the permission and visibility scope, and `mask.ts` replaces the value with `{ masked: true }`. The same serializer is used by exports, dashboard, search and Slack, so there is no side door.

**3. What stops someone calling an admin endpoint by guessing the URL?** Authorization is on the server in `route()` and again in the service (`assertPermission`). Hiding a button is only cosmetic. No session gives 401, missing permission 403, out-of-scope record 404.

**4. How do you guarantee a lead is never ownerless or double-owned?** The owner is a NOT NULL column set at insert, every transfer is a single row update guarded by `FOR UPDATE` and `WHERE version = $v`, and absence/deactivation re-route in the same transaction.

**5. What if two timers fire at once, or the server restarts mid-countdown?** The deadline is a column, so a restart loses nothing. Concurrent ticks use `SKIP LOCKED` and the version check, so the lead escalates once. A crash rolls the transaction back and the next tick redoes it.

**6. Why QStash and what if it fails?** Serverless functions cannot hold timers. QStash is told the single next deadline and calls `/api/internal/tick`. The cron backstop and post-response kicks mean a lost wake only delays work briefly; correctness never depends on QStash.

**7. How are webhooks made safe against forgery and duplicates?** Signature on the raw body, constant-time compare, replay window; the event id is unique in `integration_events`, so duplicates are counted not reprocessed; the Stripe ledger also has a unique constraint on the provider reference.

**8. A payment succeeds but the customer closes the tab. How does the record update?** Stripe calls our webhook; we verify, record, mark the request paid, write the ledger and timeline, and the UI updates through the change feed. The UI polls pending links as a fallback.

**9. What happens when WhatsApp (or Stripe, Google) is down?** Sends are outbox jobs with retries, backoff and dead-lettering; the breaker stops hammering the provider; the UI shows failed messages with Retry; the rest of the platform is unaffected. The Judge Console can simulate a provider outage.

**10. Where does AI fit, and what if it is off?** AI drafts and stands in, but code (not prompts) prevents it from acknowledging, owning, stopping timers, sending payment links or promising prices. With `AI_ENABLED=false` every AI task returns "disabled" and the app works fully.

**11. How do you audit and prove the log was not edited?** Key actions call `audit.append()` with actor, time, before and after. The table is append-only for all roles and hash-chained per workspace; the audit page can verify the chain.

**12. How would a new person run it?** README "Run it locally in 5 commands": `pnpm i`, `pnpm setup:env`, `pnpm db:up`, `pnpm db:migrate && pnpm db:seed`, `pnpm dev`, then `/dev/login-as`.

## 6. Where to look when asked "show me the code"

| Topic | File |
|---|---|
| Request pipeline | `apps/web/lib/http/route.ts` |
| Permissions | `packages/core/src/auth/{permissions,effective-permissions,visibility,mask}.ts` |
| Tenant isolation | `packages/db/src/tx.ts`, `packages/db/migrations/202610181200_w0_roles.sql` |
| Timers / tick | `packages/core/src/jobs/{run-due-work,scheduler,outbox-processor}.ts`, `apps/web/app/api/internal/tick/route.ts` |
| Lead rules | `docs/03-lead-engine.md`, `packages/core/src/domain/leads`, `packages/core/src/services/leads.ts` |
| Webhooks | `packages/core/src/services/integrations-ingest.ts`, `apps/web/app/api/webhooks/**`, `packages/core/src/integrations/**` |
| Payments | `packages/core/src/services/payments.ts`, `packages/core/src/domain/payments.ts` |
| Contact history | `packages/core/src/services/{crm-contact360,contact360-providers}.ts` |
