# 13 — Parallel Development Playbook

> **Status:** Accepted (ADR-0010). Goal: **4–5 agents (plus humans) building Relay at the same time without stepping on each other**, merging to `main` several times a day.
> Pairs with: `09-build-plan.md` §0 (waves + task → lane mapping), `STATUS.md` (live board, with a Lane column), `AGENTS.md` §5.

## 1. The model in one picture

```
            W0 skeleton (1 agent, serial): makes the repo "parallel-ready"
                                   │
   ┌──────────────┬────────────────┼─────────────────┬──────────────────┐
 Lane A          Lane B           Lane C             Lane D             Lane Q
 Lead engine     Platform,        Integrations,      Experience:        QA + review
 + leads UI      auth + CRM       messaging + AI     design system,     (from W2,
 (vertical)      (vertical)       (vertical)         shell, Overview,   continuous)
                                                     Radar, i18n/RTL
   │ each wave: contract PR (≤1h) → backend PRs → UI PRs → gate check │
   └──────────────────────── merge to main many times/day ────────────┘
```

- **Lanes are vertical slices.** A lane owns its domain end to end: schema, services, API, *and* its pages. That's what lets lanes move independently. Lane D owns the cross-cutting experience: the design system, shell, shared components, Overview/Radar, i18n/RTL QA and polish.
- **Waves** sync the lanes. A wave ends at its **gate** (a demoable check in `09-build-plan.md` §0). Lanes that finish early pull W6 or P2 items from their own lane, or help Lane Q.
- A lane with a long queue may run **two agents** in separate worktrees (e.g. from W4, Lane C splits into C1 integrations and C2 AI).

## 2. Lane ownership map (who may edit what)

| Lane | Agent type(s) | Owns (create/edit freely) |
|---|---|---|
| **A** Lead engine | `lead-engine-engineer`, `frontend-engineer` | `core/domain/leads/**`, `core/services/{leads,teams,notifications}*`, `core/jobs/**`, `core/clock.ts`, `app/api/internal/tick/**`, `app/api/v1/tick-nudge/**`, `db/schema/{leads,teams,notifications}.ts`, `contracts/api/{leads,teams,notifications}.ts`, pages `app/[locale]/(app)/{leads,recovery,automations}/**`, `app/f/**`, `components/leads/**`, `messages/*/leads.json`, `messages/*/automations.json` |
| **B** Platform + CRM | `backend-engineer`, `frontend-engineer` | `core/auth/**`, `core/audit/**`, `core/services/{users,roles,invites,crm*,lists,exports,imports,audit,judge}*`, `db/schema/{identity,crm,audit}.ts`, `contracts/api/{auth,users,crm,audit}.ts`, pages `(auth)/**`, `(app)/{contacts,companies,pipeline,team,audit,judge}/**`, `(app)/settings/**` (except Lane C's settings pages), `components/crm/**`, `messages/*/{auth,crm,team,settings}.json`, `db/seed/**` (seed framework + demo data) |
| **C** Integrations + AI | `integrations-engineer`, `ai-engineer` | `core/integrations/**`, `core/ai/**`, `core/services/{messaging,payments,calendar,integrations,ai}*`, `app/api/webhooks/**`, `app/api/internal/test-results/**`, `db/schema/{integrations,messaging,payments,calendar,ai,realtime}.ts`, `core/realtime/**`, `lib/realtime/**`, `app/api/v1/changes/**`, `app/api/health/**`, `apps/web/vercel.json`, `contracts/api/{messaging,payments,calendar,integrations,ai}.ts`, pages `(app)/{inbox,appointments,payments}/**`, `(app)/settings/{integrations,ai,knowledge,templates}/**`, `components/{inbox,payments,calendar}/**`, `messages/*/{inbox,integrations,ai}.json`, CI workflows |
| **D** Experience | `frontend-engineer` | `app/globals.css`, `app/[locale]/layout.tsx`, `(app)/layout.tsx`, `(app)/page.tsx` (Overview + Radar), `(app)/dev/**`, `components/ui/**` (shadcn), `components/relay/**` (shared product components), `components/overview/**`, `lib/{api-client,query,format,i18n}/**`, `nav.ts`, `messages/*/{common,overview,errors}.json`, `core/services/metrics*` + `contracts/api/dashboard.ts` |
| **Q** QA | `qa-engineer`, `reviewer` | `tests/**`, `**/*.test.ts` additions in any lane (tests only), `scripts/traceability.ts`, `docs/traceability.md`, page `(app)/traceability/**` |

**Shared files** (any lane, additive edits only, small diffs, re-pull first): `packages/db/src/schema/index.ts` (one export line per file), `contracts/src/index.ts`, `core/src/auth/permissions.ts` (already complete from W0; additions are rare), `.env.example` + `core/config.ts` (add to your lane's section), `STATUS.md`, `CHANGELOG.md`, `docs/02-data-model.md`, `docs/11-api.md`.

**Need to change another lane's file?** Make the smallest possible change, tag that lane's task in `STATUS.md` notes, and mention it in the PR. For anything bigger, ask the owning lane (via `STATUS.md` → Blockers) or wait for its PR.

## 3. Conflict-free file layout (set up in W0, task T-013)

| Hot spot | Rule that prevents conflicts |
|---|---|
| **Migrations** | Timestamped filenames: `packages/db/migrations/<YYYYMMDDHHmm>_<lane>_<slug>.sql`. Never renumber, never edit a merged migration. The runner applies in filename order and records applied files. Drizzle-kit generation is per lane's schema files, reviewed before commit |
| **Schema** | One file per domain (`schema/leads.ts`, `schema/crm.ts`, …). Never put another domain's table in your file |
| **i18n** | Messages split by namespace: `apps/web/messages/<locale>/<namespace>.json`, loaded by next-intl. Each namespace belongs to one lane. Add `en` and `ur` together |
| **Permissions** | The **full catalogue** from `06-security.md` §2 is written once in W0. Lanes consume it, rarely add |
| **Navigation** | `nav.ts` is created in W0 with **all** destinations pointing to stub pages ("Coming soon" EmptyState). Lanes replace their stub page and never touch `nav.ts` |
| **API contracts** | `contracts/src/api/<domain>.ts` per domain, owned by its lane |
| **Route handlers** | `app/api/v1/<domain>/**` per domain |
| **Seeds** | `packages/db/seed/<domain>.ts` modules + a composed `seed/index.ts` (one import line each) |
| **Outbox job handlers** | `core/jobs/handlers/<type>.ts`, registered in `core/jobs/registry.ts` (one line each) |
| **Components** | Lane-specific in `components/<area>/`. Shared/product-wide only in `components/relay/` (Lane D). Need a new shared component? Build it in your area, and Lane D promotes it later |
| **Formatting churn** | Prettier runs on staged files only (lint-staged). Never reformat files you didn't change |

## 4. Contracts-first handshake (how UI and backend run in parallel)

1. At the start of each wave, every backend-heavy task opens a **contract PR within ~1 hour**: Zod request/response schemas in `contracts/api/<domain>.ts` + **fixture builders** in `contracts/fixtures/<domain>.ts`. Merge it fast. Review is light: names and shapes only.
2. UI work starts immediately against the typed client `api.<domain>.*` (`lib/api-client`). With `NEXT_PUBLIC_API_FIXTURES=1` (dev only), the client returns fixtures instead of calling the network, so screens are fully buildable with no backend.
3. The backend implements the real route + service against the same contract. When it merges, the UI flips that domain off fixtures (per-domain flag map in `lib/api-client/fixtures.ts`).
4. A contract change after merge is a **new PR tagged `contract-change`** that updates schemas, fixtures and both sides in one go.

## 5. Independence tools (built in W0/W1)

| Tool | What it unblocks |
|---|---|
| `NEXT_PUBLIC_API_FIXTURES=1` + fixture builders | UI without backend |
| `INTEGRATIONS_FAKE=1` + fake adapters (`core/integrations/*/fake.ts`) | Messaging, payments, calendar and Telegram flows without real accounts |
| `AI_ENABLED=false` / fake `AIProvider` | Everything AI-adjacent without spending tokens |
| `pnpm db:seed` (demo workspaces, users per role) | Realistic screens and manual testing |
| **Dev login** `/dev/login-as` (lists seed users; refused unless `NODE_ENV=development` **and** `DEMO_MODE`) | Switch role in one click to test permissions |
| `/dev/kitchen-sink` | Visual check of shared components, en/ur × light/dark |
| Per-worktree databases (§6) | Parallel integration tests without collisions |
| `scripts/dev-ticker.ts` | Timers locally without QStash |

## 6. Worktrees, branches, databases, ports

```bash
scripts/wt.sh new T-124 escalation-timer   # → ../relay-wt/t-124-escalation-timer on branch t-124-escalation-timer
scripts/wt.sh list                          # active worktrees
scripts/wt.sh rm  T-124                     # remove after merge
```
`wt.sh new` creates the worktree from fresh `origin/main` (or local `main` without a remote) and writes `apps/web/.env.local` from the main checkout. It sets:
- `PORT` = 3100 + (task number mod 100), so dev servers never clash.
- `DATABASE_URL`/`TEST_DATABASE_URL` database names suffixed with `_t124`. The test setup creates the DB if missing and runs migrations.
- It runs `pnpm i` (fast with the pnpm store).

Claude Code agents can instead use the Agent tool's `isolation: "worktree"`. The same rules apply (branch name `t-<id>-<slug>`).

## 7. Merge protocol (main stays green)

1. Small PRs: **≤ ~400 changed lines, ≤ 1 day of work**. Split big tasks (contract → backend → UI).
2. Before opening: rebase on `main`, `pnpm check` green, `STATUS.md` + `CHANGELOG.md` updated (`/finish-task`).
3. Review: run the **`reviewer` subagent** on the diff. Blockers get fixed, then squash-merge.
4. **Merge order inside a wave:** contract PRs → schema/migration PRs → service/API PRs → UI PRs.
5. **Main red = stop the line.** Whoever broke it fixes it or reverts within 15 minutes. Nobody merges on top of a red main.
6. Vercel preview + Neon branch per PR. Click through UI PRs at phone width and in `/ur`.

## 8. Cadence

| When | What |
|---|---|
| Wave start | Orchestrator runs `/launch-wave Wn`: claims tasks in STATUS, spawns one agent per lane in worktrees with the kickoff prompts below |
| Every ~2–3 h | **Integration checkpoint**: merge ready PRs, pull main everywhere, run the app, update STATUS, re-plan |
| Wave end | Run the **gate** demo from `09-build-plan.md` §0. If it fails, fix before starting the next wave (Lane Q leads) |
| Session end | `/handoff` from every agent |

## 9. Lane kickoff prompts (paste into an agent, or used by `/launch-wave`)

> **Template:** "You are Lane **{X}** for wave **{Wn}** of Relay. Read `AGENTS.md`, `docs/13-parallel-development.md` (your ownership map in §2), `STATUS.md`, and your tasks' definitions in `docs/09-build-plan.md`. Your tasks this wave, in order: **{T-ids}**. Work in worktree/branch `t-<id>-<slug>` per task. Start with a contract PR if the task exposes an API (§4). Only edit files your lane owns, plus additive edits to shared files (§2). Follow the Definition of Done (`AGENTS.md` §6) and finish each task with `/finish-task`. Report the real test results. When done, take the next unclaimed task in your lane from the same or the next wave."

Lane-specific reminders to append:
- **A:** "Concurrency invariants (03 §9) get tests on real Postgres. P1 behaviour behind workspace flags."
- **B:** "Permissions + visibility + masking on every endpoint. 404 for out-of-scope IDs. Metrics come only from 03 §8 definitions."
- **C:** "Verify provider API details against current official docs. Raw-body signatures, idempotency, outbox. Fakes for tests."
- **D:** "Follow `docs/design/` exactly (tokens, components, screens). Check every component in `/dev/kitchen-sink` in en/ur × light/dark. Shared components go in `components/relay/`."
- **Q:** "Tag tests with requirement IDs. Never weaken a failing test. Report and route it to the owning lane."

## 10. Definition of "parallel-ready" (W0 exit checklist, T-013)

- [ ] Folder skeleton for every lane path in §2 (with `index.ts` placeholders)
- [ ] `nav.ts` with all destinations + stub pages; `(auth)`, `(app)`, `dev` route groups
- [ ] Full permission catalogue; `assertPermission` stub that compiles
- [ ] i18n namespace files (`en` + `ur`) for every namespace in §2
- [ ] Migration runner with timestamped files; schema index; seed index; job registry
- [ ] `contracts/api` + `contracts/fixtures` layout; typed `api-client` with fixture mode
- [ ] `scripts/wt.sh`, per-worktree DB naming in test setup, port derivation
- [ ] `/dev/login-as` and `/dev/kitchen-sink` routes (guarded)
- [ ] `pnpm check` green; CI runs on PRs
