# STATUS

> **Single source of truth for progress.** Update it when you claim, block, finish or hand off a task. Task definitions are in `docs/09-build-plan.md`.
> Status values: `todo` · `in-progress` · `review` · `done` · `blocked` · `cut`

**Last updated:** 2026-10-18 · **Phase:** Pre-development · **Current milestone:** M0 Foundation
**Code:** W0 complete on branch `w0-t013` (T-001/002/003/006/013 done). **Next up:** merge `w0-t013` to `main`, then `/launch-wave W1`. **Follow the fast track in `docs/09-build-plan.md` §0.**

## Now / next

> **RUBRIC FIRST:** we are judged on `docs/14-rubric.md` (100 pts, live). Every task must move a scorecard row to ✅. Rubric-maxxing phase starts once the current lanes merge.

- [x] Pre-dev docs, ADRs, agent workflow (this commit)
- [x] Design guidelines integrated: `docs/design/` (Warm Orange)
- [x] Parallel development playbook: `docs/13-parallel-development.md`, `scripts/wt.sh`, `/launch-wave`
- [x] W0 parallel-ready skeleton (T-013): lanes can start W1
- [ ] `git init` + GitHub repo + Vercel/Neon projects (T-004 needs these)
- [ ] Assign account owners in `docs/12-demo-and-ops.md` §1

## Task board

Lanes: **A** lead engine + leads UI · **B** platform/auth/CRM · **C** integrations + AI (C1/C2 split in W4) · **D** experience/design system · **Q** QA. Ownership map: `docs/13-parallel-development.md` §2.

### W0: parallel-ready skeleton (1 agent, serial)
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-001 | Monorepo scaffold + lint/test tooling | W0 | done | agent:w0 | w0-skeleton | Next 16.4.2, React 19.3, TS 6.0.3 (typescript-eslint caps <6.1), ESLint 10 + layering rules, Vitest 5 projects, Playwright skeleton |
| T-002 | DB foundation, roles, RLS harness | W0 | done | agent:w0 | w0-skeleton | Postgres 16 compose; own runner `packages/db/src/migrate.ts`; `relay_enable_tenant_rls()`; RLS suite green |
| T-003 | Config/env validation + secret encryption | W0 | done | agent:w0 | w0-skeleton | `core/config.ts` lazy per-section; Slack vars (ADR-0011); `core/secrets.ts` v1 envelopes |
| T-006 | API conventions, AppError, CSRF, rate limit | W0 | done | agent:w0 | w0-skeleton | `lib/http/route.ts`, `core/auth/csrf.ts` (signed double-submit), `rate_limits` + limiter, `errors` en/ur |
| T-013 | Parallel-ready skeleton | W0 | done | agent:w0 | w0-t013 | 13 §10 checklist done (CI = T-011). next-intl 4.14.9 + `proxy.ts`; `nav.ts` + 16 stub pages; permission catalogue; api-client fixture mode + `/api/v1/me` example; `db:new`/`db:seed`; husky+lint-staged; wt.sh `env`/`--purge`; migration runner retries cluster-catalog races (found by the 2-worktree proof) |

### W1: platform
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-007 | Audit log core + hash chain trigger | B | review | agent:lane-B | `worktree-agent-a7db47d6327108780` | `audit_events` + triggers + `audit.append`/`verifyChain` + POST `/audit/verify` |
| T-008 | Outbox + runDueWork + tick + QStash wake | A | review | agent:lane-A | `worktree-agent-a7f316dc34f62c56e` | Due-work processor list `core/jobs/processors.ts` (W2 adds lead timers). `QSTASH_URL` added. Nudge happy path untested until T-101 sessions |
| T-010 | Seed framework | B | review | agent:lane-B | `worktree-agent-a7db47d6327108780` | 2 workspaces, 7 users, password `relay-dev-password`; factories; `/dev/login-as` POST |
| T-101 | Signup/login/sessions | B | review | agent:lane-B | `worktree-agent-a7db47d6327108780` | pages at `/login` + `/signup` (07 §1 route map); provisioning hooks for teams/pipelines (Lane A / T-111) |
| T-102 | Permissions, visibility, masking | B | review | agent:lane-B | `worktree-agent-a7db47d6327108780` | `mask.ts`, `visibility.ts`, `requirePage()`; gated stub pages of all lanes |
| T-004 | Vercel + Neon pipeline, `/api/health` | C | review | agent:lane-C | `worktree-agent-ad3342c438279be17` | vercel.json + vercel-build (migrate as owner, then next build); runtime URL rewrite to app_user via APP_DB_PASSWORD; health asserts role |
| T-009 | Realtime change feed (polling) | C | review | agent:lane-C | `worktree-agent-ad3342c438279be17` | emit(), /changes, useRealtime(); Lane A wires pruneRealtimeEvents into the tick; Lane D mounts the hook |
| T-011 | CI + traceability reporter | C | review | agent:lane-C | `worktree-agent-ad3342c438279be17` | ci.yml (static/test/build), `pnpm test:ci`, `pnpm traceability` |
| T-005 | i18n + RTL scaffold | D | review | agent:lane-D | `t-d-w1-design` |  |
| T-012 | Design system + app shell + kitchen sink | D | review | agent:lane-D | `t-d-w1-design` |  |

### W2: P0 core loop
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-120 | Teams + availability | A | todo |  |  |  |
| T-121 | Routing domain (pure) | A | todo |  |  | critical path |
| T-122 | Intake: manual + public form | A | todo |  |  | critical path |
| T-123 | Acknowledge + notifications + countdown | A | todo |  |  | critical path |
| T-124 | Escalation timer + chain | A | todo |  |  | critical path |
| T-110 | Contacts/companies/opportunities CRUD | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-111 | Pipelines & stages + board | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-112 | Custom fields | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-116 | Activity timeline, notes, call logs | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-140 | Integrations page + sync history | C | review | agent:lane-C | `worktree-agent-a50aa6117f9801e8f` | page at settings/integrations; connections CRUD + secrets + breaker + sync history API; audit via seam until T-007 merges |
| T-145 | Slack alerts + linking | C | review | agent:lane-C | `worktree-agent-a50aa6117f9801e8f` | critical path; Lane A hook: `enqueueSlackAlert(tx, …)` in core/services/slack.ts; real-Slack smoke pending (token not in worktree env) |
| T-150 | Metrics + dashboard | D | review | agent:lane-D2 | `worktree-agent-a8fa593907a99a8b6` | all F5.1 figures, role-aware, hide/show (localStorage), drill-downs; `repos/metrics.ts` is defensive (guarded) until A/B2/C4 tables land; login/signup/me/user menu/Sign out restyled |

### W3: P0 complete
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-125 | Routing retry | A | todo |  |  |  |
| T-126 | Absence reassignment | A | todo |  |  |  |
| T-127 | Deactivation transfer | A | todo |  |  |  |
| T-128 | Manual reassign | A | todo |  |  |  |
| T-129 | Recovery queue | A | todo |  |  |  |
| T-103 | Invites | B | review | agent:lane-B3 | worktree-agent-ae9c0e3d2651bcb12 | built + real e2e check; T-105 lead transfer via onUserDeactivated hook (T-127) |
| T-104 | Roles & permissions UI | B | review | agent:lane-B3 | worktree-agent-ae9c0e3d2651bcb12 | built + real e2e check; T-105 lead transfer via onUserDeactivated hook (T-127) |
| T-105 | User deactivation + sessions UI | B | review | agent:lane-B3 | worktree-agent-ae9c0e3d2651bcb12 | built + real e2e check; T-105 lead transfer via onUserDeactivated hook (T-127) |
| T-113 | Stage-required fields | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-114 | Tags | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-115 | Filters + saved lists | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-117 | Contact 360 page | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-118 | CSV export | B | review | agent:lane-B2 | `worktree-agent-a694b0e3941bc35ff` |  |
| T-151 | Audit log viewer | B | review | agent:lane-B3 | worktree-agent-ae9c0e3d2651bcb12 | built + real e2e check; T-105 lead transfer via onUserDeactivated hook (T-127) |
| T-141 | Meta WhatsApp adapter + webhook | C | review | agent:lane-C3 | `worktree-agent-ac61bef57a9c60f24` | Graph v25.0; webhook `/api/webhooks/meta/[key]`; Lane A hook `registerInboundCustomerMessageHandler` (messaging-hooks.ts); contacts/leads tables not on main: contact match is guarded (`to_regclass`) and the hook creates contact+lead |
| T-142 | WhatsApp media → Blob | C | review | agent:lane-C3 | `worktree-agent-ac61bef57a9c60f24` | private Blob (`access:'private'`), Postgres `bytea` fallback (8 MB cap) when no token; proxy `/api/v1/media/:id` |
| T-143 | Stripe payments | C | review | agent:lane-C4 | `worktree-agent-a4ed361607e8f1719` | stripe@23 (API 2026-09-30.endive); `POST /api/webhooks/stripe/[key]`, `/api/v1/opportunities/:id/payment-links`, `/api/v1/payments`; real Checkout Session + signed-event round trip verified (scripts/stripe-smoke.ts); opp/contact ids are FK-less until B2; WhatsApp send awaits C3 |
| T-144 | Google Calendar | C | review | agent:lane-C4 | `worktree-agent-a4ed361607e8f1719` | per-employee OAuth+PKCE, lazy refresh, needs_reconnect, free/busy UNION local, create/reschedule/cancel via outbox (deterministic event id), Appointments page; consent URL accepted by Google (real); full consent needs a human + redirect URIs registered |
| T-146 | Conversations inbox UI | C | review | agent:lane-C3 | `worktree-agent-ac61bef57a9c60f24` | plain markup (Lane D components pending); polls every 4 s (no TanStack in deps) |
| T-162 | Responsive + a11y pass | D | todo |  |  |  |
| T-160 | P0 baseline acceptance suite | Q | todo |  |  |  |
| T-161 | Security suite | Q | todo |  |  |  |

### W4: demo core (P1)
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-202 | Policy builder + routing trace UI | A | todo |  |  |  |
| T-203 | Slack Acknowledge button | A | todo |  |  |  |
| T-210 | Time-warp | A | todo |  |  |  |
| T-209 | Judge Console | B | todo |  |  |  |
| T-211 | Seeded demo workspaces | B | todo |  |  |  |
| T-204 | AI foundation | C1 | review | Lane C2 (AI agent) | worktree-agent-a4c320d0e5d09ec69 | Provider (OpenAI/fake), runAiTask, cap, ai_usage, prompts registry. `pnpm ai:eval` ran for real. Not yet: integration_events row, breaker, DB-store integration test. |
| T-208 | Knowledge base + templates editor | C1 | review | Lane C2b (AI agent) | worktree-agent-aad231e65b4fcaf67 | settings/ai, /knowledge, /templates (ai.manage); ai_knowledge + ai_settings tables; loadKnowledge()/getAiSettings()/aiDepsFor() for the stand-in trigger (T-206 must call them); seeds for both workspaces; ai:eval grounded cases |
| T-205 | AI triage + urgency | C2 | review | Lane C2 (AI agent) | worktree-agent-a4c320d0e5d09ec69 | triageMessage + heuristic fallback + shouldMarkUrgent; caller applies setUrgent(source:ai). |
| T-206 | AI stand-in | C2 | in-progress | Lane C2 (AI agent) | worktree-agent-a4c320d0e5d09ec69 | core done: generateStandInReply + guards + templates. Remaining: handleInbound trigger/outbox job, send, state machine, audit. |
| T-207 | Handoff card + AI brief | C2 | in-progress | Lane C2 (AI agent) | worktree-agent-a4c320d0e5d09ec69 | core done: generateHandoffBrief + baseline + en/ur i18n keys. Remaining: card UI, Slack wait, conversations.ai_brief storage. |
| T-214 | Customer language matching | C2 | review | Lane C2 (AI agent) | worktree-agent-a4c320d0e5d09ec69 | ai/lang.ts detect(); contacts.language update left to messaging lane. |
| T-201 | Lead Radar | D | review | agent:lane-D2 | `worktree-agent-a8fa593907a99a8b6` | `?tab=radar`; fixture radar plays live; Lane A must emit realtime topic `radar` |
| T-213 | Full Urdu + RTL pass | D | todo |  |  |  |
| T-212 | Traceability page | Q | todo |  |  |  |

### W5: harden + money shots
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-222 | First-to-claim + pond | A | todo |  |  |  |
| T-225 | Urgency windows | A | todo |  |  |  |
| T-220 | Audit verify-integrity UI | B | review | agent:lane-B3 | worktree-agent-ae9c0e3d2651bcb12 | built + real e2e check; T-105 lead transfer via onUserDeactivated hook (T-127) |
| T-221 | Stage rot | B | todo |  |  |  |
| T-216 | $ button, instant booking, confirmations | C | todo |  |  |  |
| T-217 | Voice-note transcription | C | review | Lane C2b (AI agent) | worktree-agent-aad231e65b4fcaf67 | media.download enqueues ai.transcribe; transcript+summary on message; Transcript component mounted in inbox; Retry API; onTranscriptReady hook for stand-in/triage continuation (F8.2) not yet consumed. Real TTS->transcribe run passed |
| T-215 | Revenue at Risk / Rescued / AI stats | D | todo |  |  |  |
| T-228 | PWA + demo polish | D | todo |  |  |  |

### W6: only if time remains
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-223 | Skills + per-employee capacity | A | todo |  |  |  |
| T-224 | Idle re-trigger + counter | A | todo |  |  |  |
| T-226 | CSV import | B | todo |  |  |  |
| T-218 | Describe-your-business onboarding | C | todo |  |  |  |
| T-219 | AI field type | C | todo |  |  |  |
| T-227 | Event replay | C | todo |  |  |  |

### P2: stretch
| ID | Task | Lane | Status | Owner | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| T-305 | Deal health score | B | todo |  |  |  |
| T-301 | Push-to-talk | C | todo |  |  |  |
| T-302 | Voice commands | C | todo |  |  |  |
| T-304 | Suggested replies | C | todo |  |  |  |
| T-303 | Command bar + NL filters/rules | D | todo |  |  |  |
| T-306 | Work this list | D | todo |  |  |  |

## Blockers

_None yet._ Format: `- [T-xxx] what is blocked · why · who can unblock · since <date>`

## Open questions

_None open._ New ones go here as `| OQ-n | question | default we're building | source |`, and move to Resolved once decided.

## Discrepancies with requirements

_None open._ If a conflict with `requirements.md` is found, record it here and keep the requirement's behaviour.

## Resolved

| # | Decision | Where |
|---|---|---|
| OQ-1 | Fallback custody does not count toward the custodian's capacity | `03-lead-engine.md` §11 |
| OQ-2 | Manual assign to an ineligible user only with explicit override + reason (audited) | §11 |
| OQ-3 | Custodian works the lead via "Take over" (if eligible) or an override | §11 |
| OQ-4 | Slack alert on every assignment; escalation alerts mandatory | §11 |
| OQ-5 | A returning customer after their lead closed gets a new lead on the same contact | §11 |
| OQ-6 | One workspace per user account; email globally unique | ADR-0004 |
| OQ-7 | Tight timeline, with the team plus parallel AI agents → follow the fast-track waves | `09-build-plan.md` §0 |
| S-1 | Realtime = polled change feed (no Ably); backstop = QStash cron schedule (no cron-job.org) | ADR-0003, ADR-0002 |
| A-1 | Amendment: notification channel is Slack, not Telegram (Telegram unreliable in Pakistan; the PDF accepted Slack for I4). Wherever `requirements.md` says Telegram (C4, F1.4, F3.4, F3.5, F3.9, F9.2, I4.x, §8–§10), read Slack. `requirements.md` is unchanged. | ADR-0011, `AGENTS.md` §1 |

## Session log (append-only, newest last)

- **2026-10-18 · Claude (pre-dev):** Created `docs/00–12`, ADR-0001..0008, AGENTS.md/CLAUDE.md, `.claude` agents and commands, STATUS/CHANGELOG, `.env.example`. Deploy target switched to Vercel + Neon at the user's request, and the architecture was adapted (serverless timers, Ably realtime, transaction-local RLS). Waiting for the design guidelines.
- **2026-10-18 · Claude (pre-dev):** At the user's request: all open questions resolved with defaults, organizer caveat dropped, Ably → polled `realtime_events` change feed, cron-job.org → QStash schedule, fast-track wave plan added (`09-build-plan.md` §0). Next: W0.
- **2026-10-18 · Claude (pre-dev):** Integrated the design package (Warm Orange) into `docs/design/` (tokens, components, screens, decisions DS-1..14) + ADR-0009. Added the parallel playbook (doc 13, ADR-0010, `scripts/wt.sh`, `/launch-wave`), vertical lanes, T-012/T-013, and the Wave/Lane board. Project named **Relay**.
- **2026-10-18 · Claude (docs):** Switched the I4 notification channel from Telegram to Slack: ADR-0011, amendment A-1 in `AGENTS.md` §1, and all docs/`.env.example`/agent files updated (Slack app manifest, `/relay link`, `slack.send`, Block Kit Acknowledge button). `requirements.md` untouched. No code yet; T-145/T-203 renamed.
- **2026-10-18 · agent:w0:** T-001, T-002, T-003, T-006 done on `w0-skeleton` (4 commits). `pnpm check` + `pnpm build` green locally against Docker Postgres. Slack replaces Telegram in config/.env.example per coordinator (ADR-0011; other docs handled elsewhere). Extension points for T-013/T-101 listed in the W0 report: `lib/http/session.ts#resolveActor`, `core/auth/actor.ts`, `contracts/src/errors.ts`, `db/src/schema/index.ts`, `messages/<locale>/errors.json`.
- **2026-10-18 · agent:w0:** T-013 done on `w0-t013` (6 commits). Skeleton per 13 §10; endpoint recipe in 13 §4. Proved two `wt.sh` worktrees run `pnpm test` simultaneously (105/105 each) after fixing a real clash: concurrent first-time migrations collided on the cluster-global `app_user` role ("tuple concurrently updated"); runner now retries. `pnpm check` + `pnpm build` green. Note: an uncommitted `.gitignore` edit (`.vercel`, `.env*`) appeared from outside this task and was left uncommitted (`.env*` after `!.env.example` re-ignores it).
- **2026-10-18 · agent:c2-ai:** T-204/T-205/T-214 -> review; T-206/T-207 core done (branch `worktree-agent-a4c320d0e5d09ec69`). `@relay/core/ai` exports triage, stand-in (+guards, static en/ur/ur-Latn templates), handoff brief, runAiTask with daily cap + `ai_usage`. Defaults gpt-4.1-mini (chat) / gpt-4.1-nano (triage) / gpt-4o-mini-transcribe. `pnpm ai:eval` run against real OpenAI, ~$0.0003/call. Not built: outbox jobs, trigger/state machine (messaging lane), integration_events row, breaker, transcription task.
- **2026-10-18 · agent:lane-B2:** T-110…T-118 in `review` on `worktree-agent-a694b0e3941bc35ff`: crm schema/migration (`202610181303_b_crm.sql`), services `core/services/crm-*.ts` + `lists.ts` + `exports.ts`, ~40 `/api/v1` routes, screens (contacts, contact 360, companies, pipeline board/table, settings pipelines/fields/tags; en + ur), CRM seed (Sunrise 10 contacts/9 opps, Crescent 5/4). Lane A hook: `onHumanAction(tx, {leadId?, contactId, actor})` / `registerHumanActionHandler` in `core/services/crm-activity.ts` (the handler must check the actor owns the lead). Lane C hook: `registerContact360Provider(kind, fn)` in `core/services/crm-contact360.ts`. `contactScopeSql` now calls the late-bound `crm_contact_has_open_lead()` (works before Lane A's `leads` table exists). Real Playwright check against `pnpm dev:web` passed (see report).
