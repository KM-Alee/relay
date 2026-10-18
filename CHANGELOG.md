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
