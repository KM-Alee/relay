# 09 — Build Plan

> **Status:** Accepted plan. Task **status** lives in `/STATUS.md` (single source of truth). This file holds the **definition** of each task: scope, requirement IDs, dependencies and the "done when" check.
> Order follows requirements §10. **P0 first, end-to-end, with P1 switched off.**

## 0. Fast track (THE order to follow; time is short)

We assume a tight timeline with the team plus parallel AI agents. **How lanes, ownership, contracts-first and worktrees work: `13-parallel-development.md`.** Lanes are vertical slices: each owns its schema, services, API **and pages**. Lane D owns the design system, shell and Overview. Lane Q tests and reviews continuously. Don't start a wave until the previous **gate** passes. Each task's wave and lane is also in `STATUS.md`.

| Wave | Lane A: lead engine + leads UI | Lane B: platform, auth, CRM | Lane C: integrations + AI | Lane D: experience | Lane Q: QA | Gate |
|---|---|---|---|---|---|---|
| **W0 parallel-ready skeleton** (1 agent, serial) | T-001 → T-002 → T-003 → T-006 → **T-013** | | | | | `pnpm check` green; RLS test passes; W0 checklist (13 §10) complete |
| **W1 platform** | T-008 (jobs/tick/QStash) | T-101 + T-102 (auth, permissions, masking), T-007 (audit), T-010 (seed) | T-004 (Vercel + Neon live), T-009 (change feed), T-011 (CI) | T-005 (i18n/RTL), **T-012** (design system + shell + kitchen sink) | – | Prod URL live with the Relay shell; login works; QStash tick runs; kitchen sink in en/ur × light/dark |
| **W2 P0 core loop** | T-120, T-121, T-122, T-123, T-124 + leads list/detail, notifications panel, public form pages | T-110, T-111, T-112, T-116 + contacts, board, timeline pages | T-140 (integrations page), T-145 (Slack) | T-150 (Overview on fixtures → real metrics) | test harness, invariant tests for T-121/T-124 | **Loop demo:** form lead → assigned with trace → ignored → escalates → Slack alert → ack |
| **W3 P0 complete** | T-125, T-126, T-127, T-128, T-129 (+ Recovery page) | T-113, T-114, T-115, T-117, T-118, T-103, T-104, T-105, T-151 | T-141, T-142, T-146 (WhatsApp + Inbox), T-143 (Stripe), T-144 (Google) | T-150 finish (all 8 figures), T-162 first pass | T-160, T-161 | Every P0 row works by hand; WhatsApp round-trip on a real phone; baseline suite green |
| **W4 demo core (P1)** | T-210 (time-warp), T-203 (Slack ack), T-202 (Automations builder + trace UI) | T-211 (demo workspaces), T-209 (Judge Console) | C1: T-204, T-208 · C2: T-205, T-206, T-207, T-214 | T-201 (Lead Radar), T-213 (full Urdu/RTL pass) | AI-off suite, T-212 | Requirements §8 demo steps 1–5 run live |
| **W5 harden + money shots** | T-225, T-222 | T-220, T-221 | T-216 ($ button + booking after form), T-217 (voice notes) | T-215 (Revenue at Risk/Rescued), T-228 (PWA + polish), T-162 final | T-160/T-161 with P1 on **and** off | Full suite green both ways; demo rehearsed twice |
| **W6 only if time remains** | T-223, T-224 | T-226 | T-227, T-218, T-219 | – | – | – |
| **P2** | – | T-305 | T-301, T-302, T-304 | T-303, T-306 | – | – |

**Speed rules**
- **Design is ready** (`docs/design/`). Build screens with the real tokens and components from day one. Lane D ships the shell + shared components in W1, so other lanes compose rather than invent.
- **Contract PR first** for every API task (13 §4). UI lanes never wait for backends.
- **One happy path per integration first, then failures.** E.g. WhatsApp text in/out first, then statuses, opt-out, window and media.
- **Tests where judges poke:** lead invariants, RLS/IDOR, webhook signature + duplicate, AI-off. Lighter tests elsewhere.
- **Don't gold-plate settings.** RuleSummary + basic forms are enough for P0.
- If a wave slips, cut W6 first, then follow the scope-cut ladder (§5). Never cut P0.

## 1. Milestones

| Milestone | Exit criteria | Tasks |
|---|---|---|
| **M0 Foundation live** | Monorepo builds. Vercel production URL serves a localized shell. Neon migrations run as owner and the app runs as `app_user` with RLS proven by a test. `/api/internal/tick` runs from QStash and the cron backstop. Audit append works. CI green. | T-001…T-013 |
| **M1 P0 lead loop** | Manual + public-form lead → routed with trace → in-app countdown → ack or escalate → Slack alert → recovery queue, with everyone-offline fallback custody working | T-101…T-105, T-110, T-120…T-129, T-145 |
| **M2 P0 CRM + integrations** | Custom fields/pipelines/required fields/tags/saved lists/export. WhatsApp in/out with status. Stripe paid/expired/refund. Google booking with free/busy. Integrations page + sync history. | T-111…T-118, T-140…T-144, T-146 |
| **M3 P0 verified** | Dashboard + audit viewer. Baseline acceptance suite (requirements §10 a–e) and security suite green. Responsive/a11y pass. | T-150, T-151, T-160…T-162 |
| **M4 Demo core (P1)** | Demo script steps 3–5 work live: Lead Radar, AI stand-in + handoff, Slack Acknowledge, Judge Console, time-warp, seeded workspaces | T-201…T-212 |
| **M5 P1 complete** | All remaining P1 rows pass | T-213…T-228 |
| **M6 P2 stretch** | Only after M5 | T-301…T-306 |

## 2. Parallel work streams

See `13-parallel-development.md`: lanes A/B/C/D/Q, the file-ownership map, contracts-first, worktrees, the merge protocol, and kickoff prompts. Each task's lane is listed in §0 and in `STATUS.md`.

## 3. Tasks

Legend: **Size** S ≤ 2 h, M ≤ half day, L ≤ 1 day (agent-time, rough).

### Phase 0: Foundation (M0)

| ID | Task | Reqs | Depends | Size | Done when |
|---|---|---|---|---|---|
| T-001 | Monorepo scaffold: pnpm workspaces, TS strict, ESLint/Prettier, boundary lint (layering per 01 §3), Vitest, Playwright skeleton, Next.js in `apps/web`, packages `contracts/db/core`, scripts in root `package.json` (see `10-conventions.md` §6) | Q14 | – | M | `pnpm lint typecheck test build` passes on an empty app |
| T-002 | DB foundation: docker-compose Postgres 16; Drizzle config; SQL migration runner (owner, unpooled); `app_user` role migration; `withWorkspaceTx`/`withSystemTx`; RLS policy template; RLS test harness | Q6, F1.6 | T-001 | M | A test proves `app_user` can't read another workspace's row even with `WHERE id=` |
| T-003 | Config & secrets: `core/config.ts` Zod env validation; `.env.example` kept in sync; AES-256-GCM `secrets.encrypt/decrypt` | Q13, I5.3 | T-001 | S | Boot fails clearly on a missing env var; round-trip encryption test |
| T-004 | Vercel + Neon pipeline: project root `apps/web`, region `sin1`, Neon integration (preview branches), `vercel-build` runs migrations, `/api/health` (DB ping) | Q18 | T-002, T-003 | S | Production URL health check is green; a preview deploy uses its own branch |
| T-005 | i18n + shell scaffold: next-intl `en`/`ur`, `[locale]` routing, `lang`/`dir` on `<html>`, Nastaliq font loading, lint rules (no literal JSX strings, no physical left/right classes), placeholder shell (design pending) | F7.1–F7.3, Q16, Q8 | T-001 | M | Switching to `ur` flips to RTL; the lint catches a hard-coded string |
| T-006 | API conventions: `AppError` + codes, `route()` handler wrapper (session → actor → Zod → service → JSON), CSRF double-submit + Origin check, `rate_limits` limiter, localized error rendering on the client | Q3, Q10, F1.5 | T-002 | M | Wrapper unit tests; a CSRF-less POST gets 403 |
| T-007 | Audit core: `audit_events` table, append-only trigger, REVOKE grants, hash-chain BEFORE INSERT trigger (pgcrypto + advisory xact lock), `audit.append()`, `audit.verify()` | F4.1, F4.3, F4.4 | T-002 | M | Tests: UPDATE/DELETE as `app_user` fail; tampering detected at the right `seq` |
| T-008 | Jobs: `outbox` + `scheduler_state` + `job_runs`; claim functions (SKIP LOCKED); `runDueWork()`; `/api/internal/tick` (QStash signature, CRON_SECRET); `after()` kick helper; `scripts/dev-ticker.ts`; QStash `WakeScheduler` with `ensureWakeBy` | Q5, F3.8 | T-002, T-003 | L | Two concurrent ticks process each outbox row once; a crash-before-commit test reprocesses exactly once |
| T-009 | Realtime change feed: `realtime_events` table + `realtime.emit(tx)`; `GET /api/v1/changes?since=`; client `useRealtime()` poller (2 s / 1 s on live screens, paused when hidden, dedupe); pruning in tick | Q11 | T-006 | S | Two browsers: a change in one shows in the other within 2 s, with no refresh |
| T-010 | Seed framework: `pnpm db:reset`, `pnpm db:seed` (idempotent), factories reused by tests | F10.4 (base), Q13 | T-002 | S | One command produces a login-able workspace |
| T-011 | CI: GitHub Actions (lint, typecheck, unit, integration with a Postgres service); `scripts/traceability.ts` (test JSON → `test_results` + `docs/traceability.md`) | F10.3 (base) | T-001 | M | PR shows checks; a traceability file is generated |
| T-012 | **Design system + app shell** (`docs/design/`): tokens in `globals.css` (light/dark), Tailwind mapping, Inter + Nastaliq fonts, shadcn/ui base restyled, TopNav/MoreMenu/SearchCommand shell/Notifications panel shell/AvailabilitySwitcher/TimeWarpBadge, Card/KpiTile/ChartCard/StatusBadge/AlertChip/CountdownRing/OwnerChip/AIBadge/MaskedValue/EmptyState/Skeleton/DataTable→cards/Button/FormField/Drawer/Toast, decorative orange-glass SVG, `/dev/kitchen-sink`, lint bans on raw colours | Q7, Q8, Q16, Q17, F7.2–F7.3 | T-005 | L | Kitchen sink passes axe in en/ur × light/dark; phone width has no horizontal scroll |
| T-013 | **Parallel-ready skeleton** (13 §10): lane folders, `nav.ts` with stub pages, full permission catalogue, i18n namespaces, timestamped migration runner, schema/seed/job registries, contracts + fixtures layout, typed api-client with fixture mode, `scripts/wt.sh` DB/port wiring, `/dev/login-as` (guarded) | Q14 | T-001…T-006 | M | W0 checklist complete; two worktrees run tests at the same time without clashing |

### Phase 1: P0 baseline (M1–M3)

**AUTH**

| ID | Task | Reqs | Depends | Size | Done when |
|---|---|---|---|---|---|
| T-101 | Sign up (creates workspace + Owner + default team/pipeline/policy/permissions), login, logout, persistent DB sessions, login rate limit | F1.1, Q1 | T-006, T-007 | M | Refresh keeps the session; the 6th bad password in a minute is rate-limited |
| T-102 | Permission catalogue, effective-permission resolver, `assertPermission`, record-visibility helpers, **single value-masking serializer** | F1.3, F1.4, F1.5, Q2 | T-101 | M | Direct API calls without a permission get 403 (tests per permission); value is masked in every serializer |
| T-103 | Invites: create (level/role), copy single-use link, expiry, revoke, accept → join workspace | F1.2 | T-102 | S | Used, expired or revoked links fail; audited |
| T-104 | Roles & permissions UI: level defaults, custom roles, seeded Manager, user overrides; Admin can't modify Owner | F1.2, F1.3, F1.7 | T-102 | M | A role change applies on the next request; audited |
| T-105 | User lifecycle: deactivate (sessions killed, leads transferred via T-127), session list + revoke own, Owner revokes anyone's | F1.8 | T-101, T-127 | S | A deactivated user's open tab gets 401 on the next call |

**CRM**

| ID | Task | Reqs | Depends | Size | Done when |
|---|---|---|---|---|---|
| T-110 | Companies, contacts, opportunities CRUD + relationships + owners + soft delete + optimistic locking | F2.1, Q4 | T-102 | M | Stale edits get 409 with a conflict UI |
| T-111 | Pipelines & stages: add/rename/reorder/delete-with-forced-move; board + list with drag between stages | F2.5 | T-110 | M | Deleting a non-empty stage requires a target stage |
| T-112 | Custom fields (text/number/date/dropdown/checkbox), shared vs pipeline-specific, rendered on forms/detail | F2.2, F2.3 | T-110 | M | Two pipelines show different field sets on the same contact |
| T-113 | Stage-required fields, enforced server-side, clear message | F2.4 | T-111, T-112 | S | API move rejected with `REQUIRED_FIELDS_MISSING` listing fields |
| T-114 | Tags: Admin CRUD, attach/detach, delete cascades | F2.1 | T-110 | S | Deleting a tag leaves no dangling joins |
| T-115 | Filters (≥ 3 criteria: field, tag, stage, owner, date) + saved lists, live re-evaluation, server-validated criteria | F2.6, Q9 | T-112, T-114 | M | A record entering or leaving the criteria changes list membership with no manual action |
| T-116 | Activity timeline (all types incl. AI-labelled); notes; call logs; owner actions auto-ack (hook into T-123) | F2.7, F2.13 | T-110 | M | Timeline is ordered and shows who and when |
| T-117 | Contact 360 page: conversations, opportunities, payments, appointments, owner, timeline, AI profile slot | F2.8 | T-116 | M | All related records visible on one page |
| T-118 | CSV export (contacts/companies/opportunities/saved list) with custom fields, visibility, masking, formula-injection guard, audit (actor, scope, row count) | F2.11, F1.4 | T-115 | S | Export for a no-value-permission user has masked values |

**LEAD** (spec: `03-lead-engine.md`)

| ID | Task | Reqs | Depends | Size | Done when |
|---|---|---|---|---|---|
| T-120 | Teams + members + availability status (self/Admin), shown in team & lead views | F3.2 | T-102 | S | Status change is audited and visible live |
| T-121 | `domain/leads/route.ts` (round-robin, capacity, skip reasons, fallback owner, trace) with exhaustive unit tests | F3.3, F3.5, F3.11 (data) | T-001 | M | Table-driven tests cover every skip reason and fallback choice |
| T-122 | Intake service (T1) + manual entry (configurable sources) + public web form `/f/[slug]` + embed snippet (honeypot, per-IP rate limit, server validation, success page) | F3.1 | T-121, T-110, T-008 | M | Form submit with everyone offline → lead owned by fallback custodian with a visible reason |
| T-123 | Acknowledge (T2) + human-action auto-ack (T10) + notification centre (unread count, sound cue toggle) + countdown | F3.4 | T-122 | M | Ack via API by a non-owner gets 409; by the owner it clears the timer |
| T-124 | Escalation (T3): basic policy settings form, timer handler, overdue attempts, end-of-chain critical, alerts via outbox | F3.5, F3.8, F3.9 | T-123, T-008 | L | Concurrency invariant tests §9.1–3 pass |
| T-125 | Routing retry (T4) incl. kick on availability/capacity change | F3.3 | T-124 | S | Making someone Available assigns the waiting lead within one tick |
| T-126 | Absence reassignment (T5) + acknowledged-lead banner | F3.6 | T-124 | S | Unacked leads move; acked leads stay with the banner |
| T-127 | Deactivation transfer (T6) + guards (fallback/Owner) | F1.8 | T-124 | S | No live lead is ever owned by an inactive user |
| T-128 | Manual reassign (T7) with eligibility + override reason | F3 | T-124 | S | Audited, fresh window |
| T-129 | Recovery queue page (R1–R5 with reasons) | F3.7 | T-124 | M | Each criterion is independently testable |

**INT** (spec: `04-integrations.md`)

| ID | Task | Reqs | Depends | Size | Done when |
|---|---|---|---|---|---|
| T-140 | Integrations page, `integration_connections` CRUD with encrypted secrets, status/last OK/errors, sync history viewer, stated limits copy, permission + audit, circuit breaker | I5.1–I5.8 | T-102, T-008 | M | Secrets never appear in any API response (test) |
| T-141 | Meta WhatsApp adapter + webhook (GET verify, HMAC on raw body, dedupe on wamid), inbound → contact match/intake, send, status updates, failure + retry, opt-out, 24 h window + templates | I1.0–I1.10 | T-140, T-122 | L | A real phone round-trip works; forged and duplicate webhooks have no effect |
| T-142 | WhatsApp media download → Vercel Blob → authed proxy → thread rendering | I1.11 | T-141 | S | Images/audio/docs render; the proxy enforces permission |
| T-143 | Stripe: checkout from opportunity, send link, webhooks (completed/expired/failed/refund), idempotency, collected vs projected | I2.1–I2.8 | T-140, T-110 | M | Test card → "Paid ✓" without refresh; duplicate event recorded once |
| T-144 | Google Calendar: OAuth connect/disconnect, encrypted tokens + refresh + needs_reconnect, free/busy conflict check, create/reschedule/cancel, UTC + IANA, "no calendar" reason | I3.1–I3.7 | T-140, T-110 | L | The event appears in the real calendar; a revoked token shows Reconnect |
| T-145 | Slack: app manifest + `pnpm slack:manifest`, signed `/relay` command + interactions endpoints, `/relay link <code>` linking, `slack.send` alert content, retries with backoff, failures visible to Admins | I4.1–I4.4, F3.9 | T-140, T-124 | M | Escalation → Slack message within the same minute |
| T-146 | Conversations inbox + thread UI: assigned employee, status ticks, failed + retry, opt-out reason, window indicator, template picker | I1.1, I1.3, I1.4, I1.6, I1.7, I1.9, I1.10 | T-141 | M | Visible only to permitted users |

**DASH / AUDIT / QA**

| ID | Task | Reqs | Depends | Size | Done when |
|---|---|---|---|---|---|
| T-150 | Metrics module (`03` §8) + dashboard (8 baseline figures), drill-down on ≥ 3, role-aware, show/hide persisted | F5.1–F5.5, Q12 | T-124, T-143, T-144 | M | Each figure equals the count of its drill-down list (test) |
| T-151 | Audit log viewer with filters (type/user/date), permission-gated, no edit/delete endpoints | F4.2, F4.3 | T-007 | S | No route exists for audit mutation (test enumerates routes) |
| T-160 | **P0 baseline acceptance suite** (requirements §10 a–e) + lead invariants | §10, F3.8, Q5 | T-124…T-129 | M | All green, with every P1 flag off |
| T-161 | Security suite: RLS per table, IDOR on every `:id` route, CSRF, XSS payloads in imported/AI/transcript fields | Q2, Q3, F1.6 | T-140 | M | All green |
| T-162 | Responsive (phone/tablet/laptop, LTR + RTL) + accessibility pass | Q7, Q8 | UI tasks | M | Playwright viewport screenshots + axe checks pass |

### Phase 2: P1 (M4–M5), in requirements §10 order

| ID | Task | Reqs | Depends | Size |
|---|---|---|---|---|
| T-201 | Lead Radar (avatars + status rings, countdown rings with numbers, escalation animation, realtime) | F5.6, F3.2 | T-150, T-009 | L |
| T-202 | Visual escalation policy builder + routing trace display (lead page + audit) | F3.5 P1, F3.11 | T-124 | M |
| T-203 | Slack Acknowledge button (Block Kit `lead_ack`; verify linked user + current owner, `chat.update`, stale button ephemeral reply) | I4.5, F3.4 P1 | T-145 | S |
| T-204 | AI foundation: `AIProvider` (OpenAI), prompt registry, Zod structured outputs, timeouts/retries, usage logging, daily caps + degrade | I6.1–I6.7, Q15 | T-140, T-008 | M |
| T-205 | AI triage (language, intent, urgency, sentiment, summary) → urgent flag + shorter window | F6.6, F3.12 | T-204, T-141 | M |
| T-206 | AI stand-in: modes, triggers, disclosure, question collection, grounding, honest status, forbidden actions in code, hard handoff, fallback reply, latency path | F6.1–F6.9, F6.11–F6.13 | T-205, T-208 | L |
| T-207 | Human takeover + handoff card + "X joined" message + AI brief in Slack (never delays the baseline alert) | F6.10, F9.2, I4.2 P1 | T-206, T-145 | M |
| T-208 | Knowledge base editor + localized templates editor | F6.5, F7.6 | T-140 | S |
| T-209 | Judge Console (all F10.1 scenarios, expected vs actual) | F10.1 | T-141, T-143, T-124 | M |
| T-210 | Time-warp (multiplier, proportional reschedule, badge, audit) | F10.2 | T-124 | S |
| T-211 | Seeded demo workspaces "Sunrise Solar" + "Crescent Realty" + reset | F10.4 | most P0 | M |
| T-212 | Traceability page (+ re-run via GitHub Actions dispatch) | F10.3 | T-011 | S |
| T-213 | Full Urdu translation + RTL pass on every screen + `Intl` formatting + PKR | F7.1–F7.4, F7.7, Q16 | UI tasks | M |
| T-214 | Customer language detection + same-language replies/confirmations | F7.5 | T-205 | S |
| T-215 | Revenue at Risk, Revenue Rescued, AI stand-in stats | F5.7–F5.9 | T-150, T-206 | M |
| T-216 | "$" button in chat → WhatsApp link; instant booking after web form; localized booking confirmation | I2.1 P1, I3.8, I3.9 | T-143, T-144, T-141 | M |
| T-217 | Voice-note transcription + summary + failure/retry; transcripts feed AI/triage | F8.1–F8.3 | T-142, T-204 | M |
| T-218 | Describe-your-business onboarding (proposal → review → apply) + 3 built-in templates | F9.3 | T-204, T-111, T-112 | M |
| T-219 | AI field type (prompted fill, "AI" badge + timestamp, human wins) | F9.1, F2.2 P1 | T-204, T-112 | M |
| T-220 | Audit "Verify integrity" UI | F4.4 | T-007, T-151 | S |
| T-221 | Stage rot timers (red on board, feed recovery queue) | F2.9 | T-111, T-129 | S |
| T-222 | First-to-claim mode + claimable pond | F3.3c, F3.7 P1 | T-124, T-129 | M |
| T-223 | Skill tags routing + per-employee capacity | F3.3d–e | T-121 | S |
| T-224 | Acknowledged-but-idle re-trigger + separate dashboard counter | F3.10, F5.1 P1 | T-124, T-150 | S |
| T-225 | Urgency-based windows (manual toggle; AI-set via T-205) | F3.12 | T-124 | S |
| T-226 | CSV import with mapping, per-row validation report, dedupe by phone/email, untrusted content | F2.12 | T-112 | M |
| T-227 | Event replay from sync history (same verify + idempotency path) | I5.9 | T-140 | S |
| T-228 | PWA install + demo polish (motion budget, Lottie ≤ 5, sound cues, skeletons, dark mode, shortcuts help) | Q7, Q17 | T-012 | M |

### Phase 3: P2 (M6)

| ID | Task | Reqs |
|---|---|---|
| T-301 | Employee push-to-talk (MediaRecorder → transcription → review) | F8.4 |
| T-302 | Voice commands with confirm-before-execute | F8.5 |
| T-303 | Cmd+K command bar + NL filter chips + NL rules | F9.4 |
| T-304 | Suggested replies | F9.5 |
| T-305 | Deal health score (rules-based; AI explanation optional) | F9.6 |
| T-306 | "Work this list" mode | F2.10 |

## 4. Critical path

`T-001 → T-002 → T-008 → T-121 → T-122 → T-123 → T-124 → T-145 → (M1)`. Every other stream can start once T-002/T-006 land. The lead engine is the single highest-risk area, so give it the strongest reviewer attention.

## 5. Scope-cut ladder (if time runs out, cut from the bottom)

P2 (all) → T-306/T-305 first → T-226 import → T-227 replay → T-219 AI fields → T-218 onboarding (keep the static templates) → T-217 voice → T-221 rot → T-222 pond. **Never cut:** any P0 task, T-201, T-206/T-207, T-203, T-209, T-210, T-211.
