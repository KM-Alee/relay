# AGENTS.md: Operating Manual for AI Agents (and Humans)

You are working on **Relay**, our build of the hackathon's "Unified Business Management Platform" brief. It is a WhatsApp-first, accountability-first CRM for Pakistani SMBs: every lead always has exactly one accountable human, escalates when ignored, and an AI stand-in keeps the customer warm without ever counting as a response. Stack: **Next.js on Vercel + Neon Postgres**, TypeScript monorepo.

Read this file fully before your first change. It is short on purpose. The details live in `docs/`.

---

## 1. Sources of truth (in priority order)

1. **`requirements.md`**: the canonical requirements (v2.2). Requirement IDs (F3.5, I1.2, Q5 …) are used everywhere: tests, commits, comments.
   - **Amendment A-1 (team decision 2026-10-18, ADR-0011):** wherever `requirements.md` says *Telegram* (C4, F1.4, F3.4, F3.5, F3.9, F9.2, I4.x, §8, §9, §10), read **Slack**. The PDF accepted Slack for I4. The Telegram inline Acknowledge button (I4.5) becomes a Slack Block Kit **Acknowledge** button with identical rules.
2. **`docs/decisions/ADR-*.md`**: accepted architecture decisions.
3. **`docs/00…12`**: specs derived from the above (see `docs/README.md` for the index).
4. **`STATUS.md`**: what is being built right now, by whom, plus blockers and open questions.
5. The code.

If two sources conflict, the higher one wins. **Never silently override a requirement.** Record the conflict in `STATUS.md → Discrepancies` and keep the requirement's behaviour.

## 2. Before you touch code

1. Read `STATUS.md`. Find your task, or pick the next `todo` task **in the current fast-track wave** (`docs/09-build-plan.md` §0) whose dependencies are `done`.
2. **Claim it**: set status `in-progress`, put your agent/human name in `Owner`, and add the branch name. Do this before writing code, so parallel agents don't collide.
3. Read the docs for your area:

| Working on | Must read |
|---|---|
| Anything | `docs/00-product-overview.md`, `docs/01-architecture.md`, `docs/10-conventions.md` |
| DB / schema | `docs/02-data-model.md`, `docs/06-security.md` §3 (RLS) |
| Leads, routing, escalation, timers | `docs/03-lead-engine.md` (all of it), `docs/01-architecture.md` §6 |
| Webhooks / providers | `docs/04-integrations.md`, `docs/06-security.md` §7 |
| AI features | `docs/05-ai.md` |
| Auth, permissions, audit | `docs/06-security.md` |
| UI / i18n / RTL | **`docs/design/`** (README → tokens → components → screens), `docs/07-frontend-i18n.md` |
| Tests / Judge Console / traceability | `docs/08-testing.md` |
| Working in parallel (lanes, ownership, worktrees) | `docs/13-parallel-development.md` |
| API endpoints | `docs/11-api.md` |
| Deploy, env, provider setup, demo | `docs/12-demo-and-ops.md` |

4. Write a short plan (files you'll touch, tests you'll add, requirement IDs covered). If the task is ambiguous, check `STATUS.md → Open questions` first, then ask.

## 3. Hard rules (violations block merge)

1. **A lead is never ownerless and never double-owned.** All lead transitions go through `core/services/leads` in one transaction, with `SELECT … FOR UPDATE` plus a conditional `UPDATE … WHERE version = $v`. Spec: `docs/03-lead-engine.md`.
2. **Postgres owns time.** No `setTimeout`/in-memory timers for business deadlines. Deadlines are columns, processed by `runDueWork()`. Durations go through `clock.deadline()` (time-warp).
3. **No external call inside a DB transaction.** Side effects (WhatsApp, Slack, Google, Stripe, OpenAI, QStash) go to the **outbox** in the same transaction.
4. **Every DB access runs inside `withWorkspaceTx`/`withSystemTx`** (transaction-local `set_config`). Never use plain `SET`, `LISTEN`, or session advisory locks (Neon pooler). The runtime role is `app_user`, never the owner.
5. **Authorization on the server, in services.** `assertPermission(actor, key)` plus record-visibility scope on every read and write. Other workspaces' or out-of-scope IDs → **404**. Opportunity value goes through `core/auth/mask.ts` everywhere (UI, exports, dashboard, AI input, Slack).
6. **Webhooks**: verify the signature on the **raw body** → record idempotently → 200 → process from the outbox.
7. **AI never acknowledges, owns, stops timers, sends payment links, books, or promises prices/discounts.** Enforce this in code, not just in prompts. The app must fully work with `AI_ENABLED=false`.
8. **P0 must work with every P1 feature flag off.** New P1 behaviour that touches P0 flows sits behind a workspace flag.
9. **No hard-coded UI strings** (use next-intl keys in `en` + `ur`). **CSS logical properties only** (`ms-/me-/ps-/pe-/start-/end-`), never `left/right`, so RTL works. **Design tokens only.** Brand orange never signals warning or urgency (`docs/design/README.md` DS-3).
10. **No secrets** in code, logs, API responses or commits. Add new env vars to `.env.example` and `core/config.ts`.
11. **Audit** every action listed in F4.1 via `audit.append()`. The audit table is append-only; never write code that updates or deletes it.
12. **Zero cost.** Don't add paid services. Don't add a dependency that duplicates the stack in `docs/01-architecture.md` §1 without an ADR.

## 4. How to build

- Business rules go in `packages/core/src/domain` (pure, `now` passed in) and are unit-tested exhaustively. Use cases go in `services/`. Route handlers stay thin.
- Write the test first for domain logic and concurrency. **Test titles start with requirement IDs:** `it('[F3.8] two timers escalate once', …)`. This feeds the traceability page (F10.3).
- Run `pnpm check` (lint + typecheck + tests) before declaring anything done. If you can't run something (e.g. no DB), say so explicitly in your report and the PR. Never claim it passed.
- UI: follow `docs/design/` exactly. Use **tokens only** (no raw hex or Tailwind palette colours), shared components from `components/relay/`, and check `/dev/kitchen-sink`. Check phone width, `/ur` (RTL) and dark mode.

## 5. Parallel-agent protocol (full playbook: `docs/13-parallel-development.md`)

- You work in a **lane** (A lead engine · B platform/CRM · C integrations/AI · D experience · Q QA). **Edit only files your lane owns** (ownership map: doc 13 §2). Shared files get small additive edits only.
- **One task = one branch = one worktree** (`scripts/wt.sh new T-xxx slug`, or the Agent tool's `isolation: "worktree"`). Each worktree gets its own DB name and dev port.
- **Contracts first:** if your task exposes an API, merge the Zod contract + fixtures within the first hour so UI work can proceed in fixture mode.
- Migrations are **timestamped** (`<YYYYMMDDHHmm>_<lane>_<slug>.sql`). Never edit a merged migration. i18n, schema, contracts, seeds and job handlers are split per domain, so don't create shared mega-files.
- Small PRs (≤ ~400 lines), rebased on `main`, `pnpm check` green, reviewed by the `reviewer` subagent. **Red main = stop the line.**
- If blocked: set the task to `blocked`, write the reason in `STATUS.md → Blockers`, and pick another task in your lane.

## 6. Definition of Done (every task)

- [ ] Acceptance criteria for each requirement ID met, and the "Done when" in `docs/09-build-plan.md` met
- [ ] Tests added, titled with requirement IDs; `pnpm check` green (or the gap explicitly reported)
- [ ] Server-side permission checks + masking + RLS respected; no secrets leaked
- [ ] Audit + activity + realtime hint written for state changes (where applicable)
- [ ] i18n keys in `en` and `ur`; RTL and mobile checked for UI work
- [ ] Docs updated if behaviour, schema, env, endpoints or decisions changed (`docs/10-conventions.md` §5)
- [ ] `STATUS.md` updated (status → `review`/`done`, notes) and a `CHANGELOG.md` line under `[Unreleased]`
- [ ] Commit messages: `type(scope): summary [T-xxx] [Req-IDs]`

## 7. Reporting back

When you finish (or stop), report: what changed (files), the requirement IDs covered, tests run and their real results, anything skipped or uncertain, and follow-ups. Append a 2–4 line entry to `STATUS.md → Session log`. Be honest: a clearly reported gap is better than a false "done".
