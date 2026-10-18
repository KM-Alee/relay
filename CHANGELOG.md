# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/) (pre-1.0 during the hackathon).

**How to add an entry:** every merged task adds one line under `[Unreleased]` in the right group (`Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Docs`), in the form `- Short user-visible description [T-xxx] [Req-IDs]`. When a demo build is tagged, rename `[Unreleased]` to the version and date and start a new `[Unreleased]`.

## [Unreleased]

### Added
- pnpm monorepo (`apps/web` Next.js 16, `@relay/{core,db,contracts}`), ESLint 10 with layering rules, Prettier, Vitest unit/integration projects, Playwright skeleton, root scripts incl. `pnpm check` [T-001] [Q14]
- Docker Postgres 16, timestamped SQL migration runner with checksums, `app_user` role migration, `workspaces` with forced RLS, `relay_enable_tenant_rls()` + template, `withWorkspaceTx`/`withSystemTx`, RLS test harness, per-worktree test DBs [T-002] [Q6] [F1.6]
- Sectioned, lazy Zod env config with fail-fast boot check; AES-256-GCM secret envelopes with key rotation [T-003] [Q13] [I5.3]
- `AppError` + error-code catalogue, `route()` handler wrapper, signed double-submit CSRF + Origin check, DB-backed fixed-window rate limiter (`rate_limits`), localized client error helper with en/ur `errors` messages, `GET /api/v1/csrf` [T-006] [Q3] [Q10] [F1.5] [Q1]
- Parallel-ready skeleton: lane folders + placeholders, per-domain schema/seed/contracts/fixtures/api-client files, full permission catalogue with level defaults + Manager role + `assertPermission`, `nav.ts` with all destinations + i18n'd stub pages, next-intl `[locale]` routing (`proxy.ts`, en/ur, RTL), 12 message namespaces, typed api-client with fixture mode and `GET /api/v1/me` example, outbox job registry, redacting logger, guarded `/dev/login-as` + `/dev/kitchen-sink`, `pnpm db:new` / `pnpm db:seed`, husky + lint-staged, `wt.sh env` / `rm --purge` [T-013] [Q14] [F1.3] [F7.1]

- `vercel.json` (sin1) + `vercel-build` (owner migrations on prod/preview, then build); `GET /api/health` with DB ping + `app_user` role assertion [T-004] [Q18]
- Runtime pool rewrites an owner `DATABASE_URL` to `app_user` via `APP_DB_PASSWORD`; boot check validates the effective user [T-004] [Q6]
- Realtime change feed: `realtime_events`, `emit()`, `pruneRealtimeEvents()`, `GET /api/v1/changes`, `useRealtime()` poller [T-009] [Q11]
- GitHub Actions CI (static, tests on postgres:16, build), `pnpm test:ci`, `pnpm traceability` reporter [T-011] [F10.3]
- Transactional outbox (lease, fencing, backoff, dead-letter), `runDueWork()` with pluggable processors + `job_runs`, `/api/internal/tick` (QStash signature or CRON_SECRET), `/api/v1/tick-nudge`, `after()` kick, QStash wake-ups + backstop schedule script, dev ticker in `pnpm dev` [T-008] [Q5] [F3.8]
- Append-only `audit_events` with DB hash chain, `audit.append`, `verifyChain`, `POST /api/v1/audit/verify` [T-007] [F4.1] [F4.3] [F4.4]
- Signup/login/logout, DB sessions (argon2id, rotation, 7 d idle / 30 d absolute), login rate limit, `/me/sessions`, `/login` + `/signup` pages [T-101] [F1.1] [F1.8] [Q1]
- Effective-permission resolver, visibility scope helpers, `core/auth/mask.ts`, server-side page gating, `GET /users(/:id)` [T-102] [F1.3] [F1.4] [F1.5] [Q2]
- Idempotent seed (Sunrise Solar + Crescent Realty, Owner/Admin/Manager/User), factories, one-click `/dev/login-as` [T-010] [F10.4] [Q13]
- Integrations connections with encrypted secrets, circuit breaker, sync history, integrations page [T-140] [I5.1]
- Slack app: manifest, signed `/relay` commands + interactions, account linking, Block Kit alerts via `slack.send`/`slack.update`, `enqueueSlackAlert` hook; verified with a real DM + update [T-145] [I4.1] [I4.3] [F3.9]
- next-intl en/ur with `lang`/`dir`, Inter + Noto Nastaliq Urdu, locale switcher, `lib/format` Intl helpers (PKR, workspace TZ, relative time) [T-005] [F7.1] [F7.2]
- Warm Orange design tokens (light/dark, no-flash theme), shadcn/Radix `components/ui`, `components/relay` product components, responsive TopNav shell, Overview shell, `/dev/kitchen-sink` with axe e2e, Relay brand mark + favicon [T-012] [Q7] [Q8] [Q17]
- ESLint rules `relay/no-literal-jsx-strings`, `relay/no-physical-direction`, `relay/no-raw-colors` [T-005] [T-012]
- AI foundation: OpenAI provider with strict structured outputs, fake provider, per-workspace daily cost cap + `ai_usage`, versioned prompts bundled at build (`pnpm ai:prompts`), `pnpm ai:eval` against the real API [T-204] [I6.1] [Q15]
- AI triage + customer language detection (en / ur / ur-Latn) with heuristic fallback [T-205] [T-214] [F6.6] [F7.5]
- AI stand-in reply core with code-level guards (prices, discounts, bookings, payment links, ETAs), localized static fallbacks and hard handoff [T-206] [F6.1] [F6.11]
- Handoff brief generation with baseline fallback [T-207] [F9.2]
- Meta WhatsApp Cloud API adapter (Graph v25.0), signed `/api/webhooks/meta/[connectionKey]`, idempotent inbound + statuses, `whatsapp.send` outbox job with retry, 24 h window + templates, opt-out; real send verified to test numbers [T-141] [I1.1] [I1.10]
- WhatsApp media → private Vercel Blob (Postgres fallback) behind authed `/api/v1/media/:id` [T-142] [I1.11]
- Conversations inbox + thread UI (status ticks, retry, window indicator, template composer, opt-out) [T-146]
- Stripe test-mode Checkout payment links, signed idempotent webhook, collected vs projected totals, Payments page; real session + webhook endpoint verified [T-143] [I2.1] [I2.8]
- Google Calendar OAuth connect, free/busy conflict check, outbox create/reschedule/cancel, Appointments page [T-144] [I3.1] [I3.7]
- CRM: contacts/companies/opportunities CRUD with owners, soft delete, optimistic locking (409), record scope + value masking [T-110] [F2.1] [Q4]
- Pipelines + stages with board/table, forced-move stage delete, server-enforced stage-required fields [T-111] [T-113] [F2.4] [F2.5]
- Custom fields (shared or per pipeline) and tags [T-112] [T-114] [F2.2] [F2.3]
- Activity timeline with notes, call logs and the `onHumanAction` hook; live saved lists with server-validated filters [T-116] [T-115] [F2.6] [F2.7]
- Contact 360 page; CSV export with masking, formula guard and audit [T-117] [T-118] [F2.8] [F2.11]
- Invites (single-use links, expiry, revoke), roles + permissions matrix, per-user overrides, Owner protection, user deactivation + session revocation [T-103] [T-104] [T-105] [F1.2] [F1.3] [F1.8]
- Read-only audit log viewer with filters + Verify integrity [T-151] [T-220] [F4.2] [F4.4]
- Overview dashboard (all F5.1 figures, role-aware, show/hide, drill-downs) + metrics service; Lead Radar live mission control [T-150] [T-201] [F5.1] [F5.6]
- Login/signup brand panel with motion, `/me` profile page, user menu with sign-out
- Lead engine: pure routing/transitions domain, teams + availability, intake (manual + public form), acknowledge, escalation timers with overdue attempts and end-of-chain critical, fallback custody, notifications API + bell, leads pages; concurrency invariants tested on Postgres [T-120] [T-121] [T-122] [T-123] [T-124] [F3.1] [F3.3] [F3.4] [F3.5] [F3.8]
- Contact 360 includes conversations, payments and appointments; payment/appointment events on the contact timeline [T-117] [F2.8]
- "Send payment link" + status badges + "Send via WhatsApp" on opportunities; "Book appointment" from the contact page [T-117] [I2.1] [I3.3]
- Slack connect card translations + design-system styling [T-145] [I4.3]
- README quickstart (`pnpm setup:env`), team explainer `docs/15-how-it-works.md`; Vercel Blob store for WhatsApp media

### Changed
- `RouteSpec.permission` and `Actor.permissions` are typed as `PermissionKey`; route errors go through the redacting logger [T-013] [Q14]
- Notifications env vars: Slack (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_ID`, `SLACK_TEAM_ID`) replace `TELEGRAM_*` in `.env.example` and `core/config.ts` (ADR-0011) [T-003]
- Notification channel Telegram → Slack (ADR-0011) [I4] [F3.9]

### Fixed
- Migration runner retries transient cluster-catalog conflicts, so parallel worktrees can migrate their own databases at the same time [T-013] [Q14]

### Docs
- 13 §4 "How to add an endpoint in 5 steps"; 13 §2/§3/§6, 07 §1, 10 §6, 11 updated to the as-built layout [T-013]
- Pre-development documentation set: product overview, architecture (Vercel + Neon), data model, lead engine spec, integrations, AI, security, frontend/i18n, testing/traceability, build plan, conventions, API catalogue, ops/demo runbook [pre-dev]
- ADR-0001..0008: stack, serverless timers, realtime, auth sessions, RLS on Neon, single mutation path, messaging/notification providers, OpenAI-only paid dependency [pre-dev]
- AI workflow: `AGENTS.md`, `CLAUDE.md`, `.claude/agents/*`, `.claude/commands/*`, `STATUS.md`, this changelog, `.env.example` [pre-dev]
- Design system (Warm Orange) integrated into `docs/design/` + ADR-0009. Parallel development playbook (doc 13, ADR-0010, `scripts/wt.sh`, `/launch-wave`), vertical lanes, T-012/T-013. Project named **Relay** [pre-dev]
- Simplified the plan for speed: polled change feed instead of Ably, QStash schedule instead of cron-job.org, open questions resolved, fast-track wave plan [pre-dev]
