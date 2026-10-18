# 10 — Engineering Conventions

> **Status:** Accepted. Applies to every human and agent contribution. Lint/CI enforce what they can; reviewers enforce the rest.

## 1. TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`. No `any`; use `unknown` and narrow. No non-null `!` except right after a Zod parse.
- **Zod at every trust boundary**: HTTP input, webhook payloads (after signature verification), env, AI output, CSV rows, Telegram callbacks. Export inferred types from `packages/contracts`.
- Prefer plain functions and modules over classes. Adapters implement interfaces (`MessagingProvider`, …) as factory functions returning objects.
- Errors: throw `AppError(code, { httpStatus, i18nKey, details })` from services. Never throw raw strings. Never leak stack traces or SQL errors to clients.
- Dates: `Date` objects in memory, `timestamptz` in DB, ISO strings over the wire. Never format dates on the server for UI; the client formats with `Intl` in the user's locale.
- Money: `bigint` in DB, `number` minor units in TS (safe below 2^53), with a `currency` beside it at all times. Never floats for money.
- IDs: UUID v7 from `core/ids.ts`.

## 2. Naming

Product name: **Relay**. Package scope: `@relay/*`. DB: `relay` (tests: `relay_test`, worktrees: `relay_t<task>`). Vercel project: `relay`. Telegram bot: `@RelayLeadsBot` (or the nearest available name).

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `lead-timers.ts` |
| React components | PascalCase file + export | `LeadCountdownRing.tsx` |
| Services | `<noun>Service` module with verb functions | `leadsService.acknowledge(actor, input)` |
| DB tables/columns | snake_case, plural tables | `lead_events.occurred_at` |
| Permissions | dot.notation | `crm.opportunity.value.view` |
| Audit actions | `<entity>.<verb>` past tense | `lead.escalated`, `role.updated` |
| Outbox job types | `<area>.<verb>` | `telegram.alert`, `whatsapp.send` |
| Error codes | SCREAMING_SNAKE | `STALE_VERSION`, `LEAD_STATE_CHANGED` |
| i18n keys | `area.screen.element` | `leads.detail.ackButton` |
| Realtime topics | plural nouns | `leads`, `messages`, `payments` |
| Feature flags | `ff_<snake>` workspace setting | `ff_idle_retrigger` |

Use the domain vocabulary from requirements §9 and `03-lead-engine.md` §1 exactly ("fallback custody", "eligible handler", "escalation" …). Don't introduce synonyms.

## 3. Business-logic rules (the ones that bite)

1. **Services own transactions.** One use case = one `withWorkspaceTx`. Never call an external API inside a transaction; enqueue to the outbox instead.
2. **Every state-changing service** writes: domain rows + `audit_events` (when the action is in the F4.1 list) + `activities` (if user-visible on the timeline) + realtime hint. Missing any of these is a review blocker.
3. **Time** comes from `clock`, never `new Date()` inside `core/domain`. Durations go through `clock.deadline(workspace, seconds)` (time-warp).
4. **Masking** goes through the single serializer in `core/auth/mask.ts`. Never hand-roll "if canSeeValue".
5. **Feature flags for P1.** Every P1 behaviour that changes P0 flow (first-to-claim, idle re-trigger, AI stand-in, Telegram buttons, instant booking) checks a workspace flag. The P0 suite runs with all of them off.
6. **Idempotency keys** on every externally triggered write (`external_event_id`, `provider_message_id`, outbox `dedupe_key`). Client mutations that could double-submit (send message, create payment link) accept a `clientKey`.
7. **Strings**: no user-facing literals in components or services. Services return codes + params; the UI translates. Customer-facing texts (WhatsApp) come from `message_templates`.

## 4. Git workflow

- `main` is always deployable (Vercel production). Work on branches: `t-<id>-<slug>`, e.g. `t-124-escalation-timer`.
- Parallel agents: **one git worktree per task** (`scripts/wt.sh`), lane file ownership, contracts-first. Full rules: `13-parallel-development.md`.
- Migrations: `packages/db/migrations/<YYYYMMDDHHmm>_<lane>_<slug>.sql` (timestamped, never renumbered, never edited after merge).
- i18n: `apps/web/messages/<locale>/<namespace>.json`, one namespace per lane/area.
- Commits: Conventional Commits with the task ID: `feat(leads): escalate on ack timeout [T-124] [F3.5]`. Types: `feat fix refactor test docs chore perf`.
- PR description: what/why, requirement IDs, tests added, screenshots for UI (LTR + RTL), and the checklist from `AGENTS.md` §6.
- Squash-merge. Every PR gets a Vercel preview with its own Neon branch. Click through it before merging.
- Never commit `.env*` files (except `.env.example`), secrets, real customer phone numbers, or generated build output.

## 5. Docs discipline

- Changed a schema → update `02-data-model.md`. Changed lead behaviour → `03-lead-engine.md`. New env var → `.env.example` + `12-demo-and-ops.md`. New endpoint → `11-api.md`. Significant decision → new ADR in `docs/decisions/`.
- Every merged task: update `STATUS.md` + add a line to `CHANGELOG.md` under `[Unreleased]`.
- If you find a conflict with `requirements.md`, **preserve the requirement**, record it in `STATUS.md` → "Discrepancies", and don't silently override it.

## 6. Root scripts (to be created by T-001; keep names stable, other docs reference them)

| Script | Does |
|---|---|
| `pnpm dev` | `next dev` + `scripts/dev-ticker.ts` concurrently |
| `pnpm build` | builds all packages + web |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | the obvious |
| `pnpm test` | Vitest unit + integration (needs local DB) |
| `pnpm test:unit` / `pnpm test:int` / `pnpm test:e2e` | subsets |
| `pnpm db:up` | `docker compose up -d db` |
| `pnpm db:migrate` | runs migrations with `DATABASE_URL_UNPOOLED` |
| `pnpm db:generate` | Drizzle migration generation |
| `pnpm db:reset` | drop + migrate (local only; refuses on a non-local host) |
| `pnpm db:seed` | demo workspaces (F10.4), idempotent |
| `pnpm traceability` | builds `docs/traceability.md` from the last test run |
| `pnpm check` | lint + typecheck + test (pre-PR gate) |
| `pnpm qstash:schedule` | creates/updates the QStash backstop schedule (`--every 1m` on demo day) |
| `pnpm telegram:set-webhook` | registers the bot webhook for `PUBLIC_BASE_URL` |
| `pnpm ai:eval` | runs the AI eval set against the real API (`05-ai.md`) |

## 7. Code comments

Comment *why*, not *what*. Reference requirement IDs where a rule comes from the spec: `// F3.5: expired window with no transfer is an overdue attempt, not an escalation`. That makes grep-based traceability work.
