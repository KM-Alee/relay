# 01 — Architecture (Relay)

> **Status:** Accepted baseline. Deploy target: **Vercel (Next.js) + Neon (Postgres)**. Decisions are recorded in `docs/decisions/ADR-0001..0008`. Change them only through a new ADR.
> **Read before:** any code work. **Pairs with:** `02-data-model.md`, `03-lead-engine.md`.

## 1. Stack at a glance

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict), Node.js 22 | One language everywhere |
| Layout | pnpm workspaces monorepo; Vercel deploys `apps/web` | Domain code is shared by routes, jobs and scripts |
| Web + API | **Next.js (App Router) on Vercel**, Node.js runtime only (never Edge), Fluid compute on | UI, JSON API, webhooks and job endpoints in one deployable |
| Database | **Neon Postgres** (prod + one branch per preview); local Postgres 16 in Docker for dev/tests | Real Postgres: RLS, triggers, `SKIP LOCKED`, advisory locks |
| DB driver | `pg` (node-postgres) pool → Neon **pooled** URL, registered with `attachDatabasePool` from `@vercel/functions`; migrations use the **unpooled** URL | Interactive transactions work over TCP from Vercel Node functions |
| ORM / SQL | Drizzle ORM + hand-written SQL migrations for RLS, triggers and grants | SQL-level control |
| Background work | **No long-running worker.** Timers + outbox live in Postgres. A stateless `runDueWork()` runs from `/api/internal/tick`, called by QStash wake-ups, a QStash cron backstop, `after()` kicks and client nudges | Vercel has no daemons; Hobby crons run only daily (ADR-0002) |
| Wake-ups | **Upstash QStash** (free tier): delayed signed HTTP call at the next deadline | Second-level timer precision on serverless |
| Backstop | **QStash schedule** (cron) calling `/api/internal/tick` every 10 min (every 1 min on demo day) | Same account as wake-ups; nothing depends on one doorbell |
| Realtime | **Polled change feed**: every state-changing tx writes tiny `realtime_events` rows (`topic`, `ids`, no data). The client polls `GET /api/v1/changes?since=<cursor>` (2 s; Lead Radar 1 s; paused when the tab is hidden) and invalidates the matching TanStack queries | Zero extra accounts; works on serverless and locally; can be swapped for a push provider later (ADR-0003) |
| Media / files | **Vercel Blob**, always served through an authenticated proxy route | Voice notes, WhatsApp media, CSV imports |
| Validation | Zod (shared contracts) | Server-side validation (Q3) |
| Auth | Own DB-backed sessions, argon2id (`@node-rs/argon2`), httpOnly cookie | Session listing / kill / deactivation (F1.8, Q1) |
| UI | React, Tailwind CSS v4, **shadcn/ui (Radix)**, lucide-react, Recharts, Framer Motion, `next-intl`, Inter + Noto Nastaliq Urdu. Design system: **`docs/design/` (Warm Orange)** | Accessible primitives, RTL + i18n (F7), motion (Q17) (ADR-0009) |
| Client data | TanStack Query against `/api/v1/*` | Optimistic UI with rollback (Q17) |
| Rate limiting | Postgres fixed-window table (`rate_limits`) | Works across serverless instances; no extra service |
| Tests | Vitest (unit + DB integration on local Postgres), Playwright (E2E) | Requirement-tagged → F10.3 |
| Local dev | `docker compose up -d db` + `pnpm dev` (Next + local ticker loop) | One-command start (Q13) |

Pin versions at scaffold time (T-001). Don't add a dependency that duplicates one of these without an ADR. Verify every free-tier limit against current provider docs before relying on it (see §10).

## 2. Topology

```
                ┌──────────────────── Browser (PWA) ────────────────────┐
                │ React UI ─ TanStack Query ─ poll /api/v1/changes (1–2 s)│
                └───────┬───────────────────────────────────────────────┘
                        │ HTTPS /api/v1/*  (data + change-feed hints)
Providers ─webhooks─►┌──▼─────────────────────────────┐
(Meta, Stripe,       │ Vercel: apps/web (Next.js)      │
 Google, Telegram)   │  • /api/v1/*       JSON API     │
                     │  • /api/webhooks/* raw-body     │
QStash ─signed POST─►│  • /api/internal/tick  runDueWork│  (QStash: next-deadline wake-ups
 (wake + schedule)   │  • after(): post-response work  │   + cron schedule backstop)
                     └──┬───────────────────────┬──────┘
                        │ pg pool (pooled URL,   │ outbound calls (from jobs)
                        │ role app_user, RLS)    ▼
                   ┌────▼─────┐        Meta / Stripe / Google / Telegram / OpenAI / Blob
                   │  Neon    │  ← single source of truth for data AND timers
                   └──────────┘
```

### Five rules that everything else follows

1. **Postgres owns time.** Every deadline is a column (`leads.escalate_at`, `leads.routing_retry_at`, `leads.idle_check_at`, `outbox.available_at`). No timer lives in memory, `setTimeout`, or QStash alone. QStash only *wakes us up*. Correctness comes from the DB. (Q5, F3.8)
2. **`runDueWork()` is idempotent and safe to run concurrently.** It claims due rows with `FOR UPDATE SKIP LOCKED` and applies conditional updates on `version`. Two ticks at once, a duplicate QStash delivery, or a crash mid-tick all produce exactly one effect.
3. **Outbox for every side effect.** A WhatsApp send, Telegram alert, Google event, OpenAI call or QStash schedule is written as an `outbox` row **in the same transaction** as the state change that causes it. Delivery happens in `runDueWork()` (usually kicked immediately via `after()`), with retries and backoff (I5.5).
4. **Webhooks: verify → record → 200 → process later.** Raw body → signature check → `INSERT integration_events … ON CONFLICT DO NOTHING` + outbox row in one tx → respond 200 → `after(() => processOutboxItem(id))`. (F6.13, I1.8, I2.4)
5. **Realtime is invalidation, not data.** `realtime_events` rows carry `{topic, ids}` only. Clients poll them and refetch. The browser refetches through the permissioned API. So realtime can never leak masked fields such as opportunity value (F1.4) or cross-workspace data.

## 3. Repository layout

```
/
├─ AGENTS.md  CLAUDE.md  STATUS.md  CHANGELOG.md  README.md  requirements.md
├─ .env.example  docker-compose.yml  package.json  pnpm-workspace.yaml  vercel.json (in apps/web)
├─ apps/
│  └─ web/                        Next.js app (Vercel project root = apps/web)
│     ├─ app/[locale]/...         pages (en | ur)
│     ├─ app/f/[formSlug]/        public web form (F3.1), no auth
│     ├─ app/api/v1/...           JSON API route handlers (thin)
│     ├─ app/api/webhooks/[provider]/[connectionKey]/route.ts
│     ├─ app/api/internal/tick/   job runner endpoint (QStash / cron / nudge auth)
│     ├─ app/api/media/[id]/      authenticated media proxy
│     ├─ components/  lib/  messages/{en,ur}.json
├─ packages/
│  ├─ contracts/  Zod schemas + TS types shared by client & server. NO server deps.
│  ├─ db/         Drizzle schema, sql/ migrations, tx helpers, seed, roles setup
│  └─ core/       All business logic. NO Next.js / React imports.
│     └─ src/
│        ├─ domain/        pure rules: routing, escalation, eligibility, metrics, health score
│        ├─ services/      use cases: (actor, input) → permission → tx → audit + outbox + realtime
│        ├─ repos/         data access; only services/jobs call these
│        ├─ jobs/          runDueWork(), lead timer handlers, outbox handlers, wake-up scheduler
│        ├─ integrations/  adapters: messaging/ payments/ calendar/ notifier/ ai/ realtime/ storage/ scheduler/
│        ├─ ai/            prompts/ (versioned files), schemas, tasks
│        ├─ auth/          sessions, passwords, permission catalogue, CSRF
│        ├─ audit/         append + verify chain
│        ├─ i18n/          customer-facing templates, language detection
│        ├─ config.ts      env parsing (Zod), fails fast
│        └─ clock.ts       Clock + time-warp
├─ scripts/        dev-ticker.ts (local loop calling runDueWork), seed, reset, traceability
├─ tests/e2e/      Playwright
└─ docs/
```

There is no `apps/worker`. "The worker" in docs means **`runDueWork()` and whatever invoked it**.

### Layering (Q14), enforced by lint (`dependency-cruiser` or `eslint-plugin-boundaries`)

```
apps/web (pages, route handlers) ──► core/services ──► core/domain (pure)
api/internal/tick, scripts       ──► core/jobs ──┘        │
                                        ├──► core/repos ──► packages/db
                                        └──► core/integrations (interfaces + adapters)
contracts ◄── imported by everyone (types/schemas only)
```

- `core/domain` is pure: no I/O and no `Date.now()`. It receives `now`. Routing and escalation decisions live here, and most unit tests target it.
- Route handlers: Zod-parse → build `Actor` from session → call **one** service → map result/`AppError` to HTTP. No SQL, no business rules.
- Services are the **only** place that checks permissions, opens transactions, writes audit events and enqueues outbox rows. Server Components read through services too.
- **No Next.js Server Actions for mutations.** Having one mutation path (`/api/v1`) gives one place for CSRF, auth and rate limits, and it lets the Judge Console prove that direct API calls are rejected (F1.5).

## 4. Database connections on Neon (critical, ADR-0005)

- **Runtime** connects as role `app_user` (no `BYPASSRLS`, not the table owner) through Neon's **pooled** endpoint (PgBouncer in transaction mode).
- Because the pooler is in transaction mode, **session state does not survive between transactions**. Workspace context is therefore set per transaction with `SELECT set_config('app.workspace_id', $1, true)` (transaction-local) inside `withWorkspaceTx()`. **Never** use plain `SET` or session-level settings. **Never** run a workspace query outside `withWorkspaceTx`/`withSystemTx`.
- `LISTEN/NOTIFY`, session advisory locks and `SET` outside a transaction are **forbidden**. Transaction-scoped `pg_advisory_xact_lock` is fine.
- **Migrations** run as the owner role over the **unpooled** URL (`DATABASE_URL_UNPOOLED`).
- Pool: `new Pool({ connectionString: DATABASE_URL, max: 5 })` is created once per module and registered with `attachDatabasePool(pool)` so Fluid compute drains idle clients correctly.
- Region: put Neon in **AWS ap-southeast-1 (Singapore)** and pin Vercel functions to **`sin1`** in `vercel.json`. This keeps DB round-trips at about 1 ms and is the closest pairing to Pakistan.
- Neon branching: the Neon↔Vercel integration creates a DB branch per preview deployment. Preview builds run migrations against their branch, so agents' PRs never touch production data.

## 5. Request lifecycle (authenticated API)

1. `middleware.ts`: locale negotiation and security headers (CSP, `frame-ancestors`, etc.). No DB access in middleware.
2. Route handler: `requireSession(req)` → cookie → `auth_resolve_session()` → `Actor { userId, workspaceId, baseLevel, permissions:Set, locale }`. Deactivated user or revoked session → 401.
3. Mutations: CSRF check (Origin/Host match + double-submit `x-csrf-token`), plus rate limit where relevant.
4. `service.fn(actor, input)` → `assertPermission` → `withWorkspaceTx(actor.workspaceId, tx => …)` → domain → repos → `audit.append` → `outbox.enqueue` → `realtime.emit(tx, {topic, ids})` (a `realtime_events` row in the same tx, visible to pollers at commit).
5. After commit: `after(() => kickDueWork())` delivers new outbox rows within milliseconds instead of waiting for the next wake-up.
6. Errors are typed `AppError { code, httpStatus, i18nKey, details }`. The client renders the localized message (Q10).

## 6. Background work on serverless (ADR-0002)

`runDueWork({ budgetMs = 20_000 })` in `core/jobs`:

```
loop until budget spent or nothing due:
  claim ≤ N due lead timers   (SECURITY DEFINER claim fn, FOR UPDATE SKIP LOCKED) → handle each in its workspace tx
  claim ≤ N due outbox rows   (same pattern) → deliver → mark sent / schedule retry with backoff
recompute next_wake_at = min(pending deadlines) → if earlier than the currently scheduled wake, schedule a QStash call
upsert job_runs heartbeat (who triggered: qstash | cron | after | nudge | dev-ticker, items processed, duration)
```

**Callers (any subset can fail without losing correctness):**

| Driver | When | Auth on `/api/internal/tick` |
|---|---|---|
| `after()` kick | Right after any request that created due work (new outbox rows, new deadline) | runs in-process, no HTTP |
| QStash wake-up | At `next_wake_at`, with a dedup ID `wake:<epoch-second>` | `Upstash-Signature` verified with the QStash signing keys |
| Client nudge | Lead Radar / countdown hits 0 → `POST /api/v1/tick-nudge` (auth'd, rate-limited) | session; it only *runs* due work and changes nothing by itself |
| QStash cron backstop | QStash schedule every 10 min (1 min on demo day) | `Upstash-Signature` (same as wake-ups) |
| Manual | operator `curl` when debugging | `Authorization: Bearer $CRON_SECRET` |
| `scripts/dev-ticker.ts` | Local dev; optional demo safety net | direct function call |

Rules:
- Each claim/handle runs in its own short transaction. Never hold a transaction open across an external HTTP call. Claim, commit, call the provider, then record the outcome in a new transaction (status `in_flight` with a lease `locked_until`, so a crashed delivery is retried after the lease expires).
- Bound every tick (`budgetMs`, batch size) so a tick stays well under the function max duration.
- **Q5 on serverless:** every invocation is effectively a fresh process, so "worker restarts mid-countdown" is the normal case. The Judge Console proves it two ways (F10.1): (a) a "crash mid-job" scenario that claims a due timer, throws before commit, and then shows the next tick processes it exactly once; (b) a "lose the doorbell" scenario that cancels the scheduled QStash wake and shows the backstop or nudge still escalates.

## 7. Time and the Clock (F10.2)

- `Clock.now()` is the real wall clock. We never fake wall time. Time-warp scales **durations**: `effectiveSeconds = configuredSeconds / workspace.time_warp_multiplier`. All deadlines go through `clock.deadline(workspace, seconds)`.
- Changing the multiplier reschedules pending deadlines proportionally (`new_due = now + (due − now) × old/new`) in one transaction. This is audited and triggers a wake-up reschedule.
- Countdown UIs show real remaining seconds, with a visible "⏩ 60×" badge whenever warp ≠ 1.

## 8. Configuration and secrets (Q13, I5.3)

- Env vars are defined in `.env.example` and validated at boot by `core/config.ts`, which fails fast. Use Vercel env scopes (Production / Preview / Development). Locally, run `vercel env pull apps/web/.env.local` or copy `.env.example`.
- Per-workspace provider credentials live in `integration_connections.secrets_enc` (AES-256-GCM, key `APP_ENCRYPTION_KEY`). They are never sent to the browser; the UI shows the last 4 characters only.
- Platform-level credentials (OpenAI key, QStash, Blob token, default Telegram bot) live in env. A workspace may override provider credentials.

## 9. Deployment

- Vercel project root `apps/web`, framework Next.js, functions region `sin1`, Fluid compute on.
- Build: `vercel-build` = `pnpm db:migrate && next build`. Migrations are idempotent and run against the Neon branch selected by env: preview → branch, production → main.
- Production domain: `https://<project>.vercel.app` (stable) or a custom domain. **Every provider webhook and OAuth redirect points at the production domain**, because preview URLs change. Drive links from `PUBLIC_BASE_URL`.
- Local webhook testing: Cloudflare quick tunnel with a **separate** dev Meta app, Telegram bot and Stripe CLI (`stripe listen --forward-to`). Never repoint production webhooks to a laptop.
- Runbook and demo-day steps: `12-demo-and-ops.md`.

## 10. Platform limits to design around (verify current numbers before relying on them)

| Platform | Constraint | Our answer |
|---|---|---|
| Vercel Hobby | Cron jobs only once/day; function max duration limited (Fluid compute); no persistent sockets | QStash wake-ups + QStash cron backstop; bounded ticks; polled change feed for realtime |
| Vercel functions | Concurrency across instances; no shared memory | All coordination in Postgres (SKIP LOCKED, `version`, unique constraints, `rate_limits`) |
| Neon free | Scale-to-zero after idle (cold start ~0.5 s); monthly compute-hour cap; small storage | Wake-ups only when deadlines exist; backstop interval ≥ 5 min outside demo; media in Blob, not DB |
| Neon pooler | Transaction mode: no session state, no `LISTEN` | `set_config(..., true)` per tx; polled `realtime_events` instead of NOTIFY |
| QStash free | Daily message cap | One wake per *next* deadline (not one per lead), with dedup IDs; backstop at 10 min = 144/day |
| Polling load | Every open tab polls the change feed, which keeps Neon awake | One indexed query per poll; pause hidden tabs; prune `realtime_events` older than 10 min in each tick |
| Vercel Blob | Free storage/bandwidth caps | Only media + imports; proxy with auth |

## 11. Failure isolation (I5.8, F6.11)

- Every adapter call has a timeout (messaging 10 s, Stripe 10 s, Google 10 s, Telegram 5 s, OpenAI chat 8 s, transcription 30 s).
- Each connection has a circuit-breaker state in `integration_connections.health`. The Judge Console can force it open to simulate an outage.
- **The lead pipeline never awaits an external call.** Intake, assignment, escalation and in-app notifications are pure DB transactions. Telegram, WhatsApp, AI and QStash are all fired from the outbox or after commit. Realtime has no external dependency. If QStash is down, the backstop and nudges keep timers firing. If OpenAI is down, a static fallback reply goes out. This is how P0 works with every P1 feature off (C20).
