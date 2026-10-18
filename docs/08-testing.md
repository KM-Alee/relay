# 08 — Testing, Traceability and the Judge Console

> **Status:** Accepted. Requirement IDs: F10.1, F10.3, Q5, Q15 ("AI off"), requirements §10 baseline acceptance checks (a)–(e), and `03-lead-engine.md` §9 invariants.
> **Code home:** `packages/core/src/**/*.test.ts` (unit), `packages/core/test/integration/**` (DB), `packages/core/src/integrations/**/__fixtures__` (provider payloads), `tests/e2e/**` (Playwright), `scripts/traceability.ts`, `.github/workflows/*.yml`.

## 1. Strategy

| Layer | Tool | Runs against | Focus | Speed target |
|---|---|---|---|---|
| **Domain unit** | Vitest | Pure functions in `core/domain` | Routing (`route()`), escalation walk, eligibility, recovery reasons, metrics math, masking, health score, language detection, trace sentences | < 5 s total |
| **DB integration** | Vitest + real **Postgres 16** (docker compose `db`, or a GH Actions service) | Services/jobs via `withWorkspaceTx`, connected as **`app_user`** | RLS, transitions T1–T11, timers via `runDueWork`, concurrency, idempotency, audit immutability + hash chain, safe deletes, optimistic locking | < 60 s |
| **Adapter contract** | Vitest + recorded fixtures + `msw` for outbound HTTP | `core/integrations/*` | Signature verify (valid / forged / altered body / wrong secret), parse inbound + status, error mapping (temporary vs permanent), timeouts, Slack v0 signature (valid / forged / stale timestamp), interaction payload | < 10 s |
| **API** | Vitest calling route handlers (`next-test-api-route-handler` or direct `POST(req)` import) | `apps/web/app/api/**` | Auth/CSRF/permission/404-scope, Zod rejection, status codes | < 20 s |
| **E2E** | Playwright | `pnpm dev` locally, or the Vercel **preview URL** + its Neon branch in CI | Core user flows, RTL, a11y, responsive | ~ 3–5 min |

Rules:
- **Never mock Postgres.** Every behaviour that depends on locks, RLS, constraints or triggers is tested on real Postgres.
- Neon-specific behaviour (PgBouncer transaction mode) is covered by running the integration suite **once per day** in CI against a throwaway Neon branch with the pooled URL (`TEST_DATABASE_URL_POOLED`). This catches any accidental session-level `SET`.
- No test hits real providers or OpenAI. Live provider checks are manual smoke steps in `12-demo-and-ops.md`.

## 2. Requirement tagging (feeds F10.3)

**Every test title starts with one or more requirement IDs in brackets:**
```ts
it('[F3.8] two simultaneous timer evaluations escalate once', async () => { … })
it('[F3.3][F3.5] at-capacity handlers are skipped with reason in trace', …)
test('[F7.2][Q7] lead detail has no horizontal scroll in RTL at 360px', …)
```
- The ID regex is `\[(F|I|Q)\d+(\.\d+)?\]`. Baseline checks use `[BASE-a]` … `[BASE-e]`, and lead-engine invariants use `[INV-1]` … `[INV-7]`.
- A test may cover several IDs. A requirement with no tagged test shows as **"untested"** on the traceability page. That's allowed, but every P0 ID must have ≥ 1 test before P0 is called done.
- `describe` blocks may carry the tag instead. The reporter inherits tags from ancestors.

### Traceability pipeline
1. Vitest: `pnpm test:ci` (= `vitest run --reporter=default --reporter=json --outputFile.json=reports/vitest.json`). Playwright: `reporter: [['json', { outputFile: 'reports/playwright.json' }]]`.
2. `pnpm traceability` runs `scripts/traceability.ts`, which:
   - parses both JSON reports, extracts tags, and builds rows `{req_id, test_name, status (passed|failed|skipped), duration_ms}`;
   - loads the full ID list from `requirements.md` (regex over the tables: `F1.1`…`I6.7`, `Q1`…`Q18`), so untested IDs appear;
   - writes `docs/traceability.md` (generated; header "do not edit by hand"; table: ID, priority, title, tests, status, last run);
   - also writes `packages/contracts/src/requirements.generated.json` (the parsed requirement list); `--strict` exits 1 on a failing or untested P0;
   - if `TEST_RESULTS_URL` + `TEST_RESULTS_SECRET` are set, POSTs `{run_id, git_sha, source:'ci', ran_at, results[]}` to `/api/internal/test-results`, signed with `x-relay-timestamp` + `x-relay-signature: sha256=HMAC(secret, "<timestamp>.<rawBody>")` (the receiver verifies in constant time and rejects timestamps older than 5 min). That endpoint inserts into `test_results` (`source='ci'`).
3. `/traceability` (F10.3) reads `test_results` (latest `run_id` per `req_id`) joined with the parsed requirement list (shipped as a generated JSON `packages/contracts/src/requirements.generated.json`).

### "Re-run from the page" (F10.3, Vercel-compatible)
Tests can't run inside a Vercel function. **Re-run** therefore calls `POST /api/v1/traceability/rerun` (perm `demo.judge_console`, demo mode only). It triggers a GitHub Actions `workflow_dispatch` on `traceability.yml` using `GITHUB_TOKEN` (a fine-grained PAT with `actions:write` on this repo), plus `GITHUB_REPO` / `GITHUB_REF` env. The page shows "Run queued → running → done" by polling `test_results` for a new `run_id`, and links to the Actions run. The **Judge Console scenarios (§6)** are the in-app, live-executing complement.

## 3. Required tests

### 3.1 P0 baseline acceptance checks (requirements §10). All are integration tests unless noted
| Tag | Test |
|---|---|
| `[BASE-a][F3.3][F3.5]` | Intake with every member Offline → lead has the active custodian (manager, or Owner if no manager) as owner, `custody='fallback'`, `awaiting_handler`, reason `no_available`. Repeat with everyone at capacity → reason `all_at_capacity` |
| `[BASE-b][F3.3][F3.7]` (built with P1 claims) | Two simultaneous claims → exactly one winner, one `claim_rejected`, one owner, `version` +1 only once |
| `[BASE-c][F3.6][F1.8][F3.5]` | Absence: pending leads reassigned, acked leads stay with an absence banner flag. Deactivation: **all** leads transferred and sessions revoked. Chain exhaustion: `is_critical`, custodian owner, never NULL, never an inactive owner |
| `[BASE-d][F3.10][F5.1]` | Ack-timeout reassignment → `escalation_count` +1 and an `escalation` event. Idle re-trigger → only `idle_retrigger_count` +1; escalation figure unchanged; `first_*` timestamps unchanged |
| `[BASE-e][F3.1][F3.4][F3.7][I4.2]` | **"AI/P1 off" suite** (§5): form capture → owner + confirmation; in-app acknowledge; recovery queue lists overdue items; Slack baseline alert enqueued with name, source, reason, link, and **no** AI brief or buttons required |

### 3.2 Lead-engine invariants (`03-lead-engine.md` §9)
`[INV-1]` owner never NULL: property-based test with `fast-check`. It generates random sequences of availability changes, intakes, acks, timer ticks and deactivations, and asserts after each step that every open lead has an active owner.
`[INV-2]`/`[F3.8]` single owner + version monotonic. `[INV-3]` two concurrent `runDueWork` → one escalation event. `[INV-4]` two claims → one winner. `[INV-5]` ack vs escalation race → exactly one outcome, the loser no-ops; a stale Slack ack is answered "stale". `[INV-6]` absence/deactivation/exhaustion never orphan. `[INV-7]` idle re-trigger keeps `escalation_count` and `first_*`.

### 3.3 Other must-have tests (minimum per area)
- **F1** `[F1.5]` direct API call without the permission → 403. `[F1.6]` the RLS suite in `06-security.md` §3. `[F1.4]` value masked in list, detail, CSV, dashboard, Slack render, AI input builder. `[F1.2]` invite single-use/expiry/revoke. `[F1.8]` deactivation kills sessions immediately. `[Q1]` login rate limit.
- **F2** `[F2.4]` stage move blocked until required fields are filled. `[F2.5]` delete stage forces move. `[F2.6]` saved list updates live. `[F2.11]` export audited + formula-neutralized. `[F2.12]` import: invalid rows reported, duplicates merged. `[Q4]` stale version → 409.
- **F4** `[F4.3]` UPDATE/DELETE as `app_user` fails. `[F4.4]` tamper (owner role edits a row) → verify reports that `seq`.
- **I1/I2** `[I1.2]`/`[I2.3]` forged signature rejected + recorded. `[I1.8]`/`[I2.4]` duplicate delivery → one message/lead/payment and `duplicate_count=1`. `[I1.4]` status never regresses. `[I1.10]` free text blocked outside 24 h. `[I1.9]` opt-out blocks human + AI. `[I2.5]` expired/failed/refund statuses. `[I2.6]` collected excludes unpaid.
- **I3** `[I3.5]` a booking across timezones stores UTC + IANA and displays correctly. `[I3.2]` refresh failure → `needs_reconnect`.
- **I4** `[I4.4]` retry with backoff then `dead`, visible. `[I4.5]` stale button changes nothing.
- **F6/I6** `[F6.11]` OpenAI timeout → static fallback reply, lead flow unaffected. `[F6.8]` forbidden actions (price not in KB, discount) are blocked by the post-validator. `[I6.4]` cap reached → degrade. `[F6.10]` human message stops stand-in.
- **F7** `[F7.1]` en/ur key parity. `[F7.7]` locale list is data-driven. E2E `[F7.2]` RTL screenshots.
- **F10** `[F10.2]` multiplier change reschedules pending deadlines proportionally.

## 4. How to test concurrency

Use real parallel connections with a **barrier**, so both transactions reach the critical point before either commits:
```ts
it('[F3.8][INV-3] two simultaneous timer evaluations escalate once', async () => {
  const lead = await factory.lead({ escalateAt: past(1) });
  const barrier = createBarrier(2);                    // resolves when 2 parties arrive
  const run = () => runDueWork({ trigger: 'test', hooks: { afterClaim: () => barrier.wait(500) } });
  await Promise.all([run(), run()]);
  expect(await countEvents(lead.id, 'escalation')).toBe(1);
});
```
- `runDueWork` and the services accept an optional `hooks` object (`afterClaim`, `beforeCommit`) that is **only** wired in tests (no-op in prod). Use it to force interleavings, including the crash case: `beforeCommit: () => { throw new Error('crash') }`, then run again and assert exactly one effect (`[Q5]`).
- Claims and acks race through `Promise.all` on two pool clients, each in its own `withWorkspaceTx`.
- Each test runs in its own fresh workspace (unique IDs), so tests can run in parallel. Truncate between files with `TRUNCATE … CASCADE` executed by the owner role.

## 5. Fixtures, factories, fakes, and the "AI off" suite

- **Factories** (`packages/core/test/factories.ts`): `workspace()`, `user({availability, capacity, skills})`, `team({members, manager, backup, policy})`, `contact()`, `lead({...})`, `opportunity()`, `conversation()`. They insert via repos inside `withWorkspaceTx` and return rows. Defaults mirror the demo seed (short windows).
- **Clock:** domain tests pass `now`. Integration tests use real time with second-scale windows and helper `past(s)`/`future(s)` to set deadlines directly. **Never `sleep()` waiting for a timer.**
- **Provider fakes** (`core/integrations/*/fake.ts`) implement the same interfaces (`MessagingProvider`, `PaymentProvider`, `CalendarProvider`, `Notifier`, `AIProvider`, `WakeScheduler`, `BlobStore`). They record calls and can be told to fail (`fake.failNext('temporary'|'permanent'|'timeout')`). `createTestContainer()` wires fakes by default.
- **Recorded fixtures:** real (redacted) payloads for Meta inbound text, audio, status (sent/delivered/read/failed), Stripe `checkout.session.completed|expired`, `payment_intent.payment_failed`, `charge.refunded`, Slack `/relay link` command and `block_actions` (`lead_ack`) payloads. Each has a matching signing secret in the fixture, so signature tests use the real algorithm.
- **AI fakes** return canned structured outputs keyed by prompt id. A golden set of Roman-Urdu / Urdu / English inputs checks language detection and triage parsing (unit). Real-model evals are a manual script (`scripts/ai-eval.ts`), never in CI.
- **"AI off" / P1-off suite** (`describe('[Q15][BASE-e] baseline with P1 off')`): sets `ai_settings.mode='off'`, disables idle re-trigger, first-to-claim, instant booking, Slack buttons, then runs the P0 flows end to end at the service level. This proves C20: P0 works independently.

## 6. Judge Console scenarios (F10.1)

Each scenario is a service in `core/judge/*` run by `POST /api/v1/judge/:scenario` (perm `demo.judge_console`, `demo_mode` on). It uses the **real code paths** against a dedicated "Judge sandbox" team/contact in the demo workspace, and returns `{expected, actual, pass, evidence[]}`. Each run is audited (`judge.scenario_run`) and recorded in `test_results` (`source='judge'`).

| Scenario | Req | What it actually does | Expected |
|---|---|---|---|
| Replay WhatsApp webhook twice | I1.8 | Builds a signed Meta payload with fixed `wamid`, POSTs it to our own public webhook URL **twice** over HTTPS | 1 message, 1 lead, `duplicate_count=1` |
| Replay Stripe event twice | I2.4 | Signed `checkout.session.completed` with fixed event id → webhook ×2 | 1 payment, revenue +once |
| Forged-signature webhook | I1.2, I2.3 | Same payload, wrong HMAC / altered body | 401, `integration_events.status='rejected'`, no state change |
| Two escalation timers at once | F3.8 | Lead with past `escalate_at`; two concurrent `runDueWork` with the barrier hook | exactly 1 `escalation` event |
| **"Restart the worker mid-countdown"** (serverless interpretation, ADR-0002) | Q5 | (a) *Crash mid-job:* claim the due lead, throw before commit, then run a fresh tick. (b) *Lose the doorbell:* cancel the scheduled QStash wake for a 10 s countdown, then show the nudge or backstop still escalates on time | (a) exactly 1 escalation after recovery; (b) escalation occurs ≤ a few seconds after the deadline, with the trigger shown (`nudge`/`cron`) |
| Cross-workspace read by ID | F1.6 | As a Sunrise user, GET a Crescent contact ID via the real API, and also run a raw `app_user` SELECT with Sunrise context | 404 and 0 rows |
| Provider outage | I5.8, F6.11 | Force the circuit breaker open for Meta (or OpenAI), then send an inbound message / create a lead | Lead flow continues; send shows failed + retry; AI falls back to the static reply; integrations page shows the error |
| Simultaneous claims | F3.3c, BASE-b | Two eligible users claim the same lead concurrently | 1 winner, 1 `ALREADY_CLAIMED` |
| Audit tamper | F4.4 | Owner-role script mutates a copy chain in a scratch schema (never the real table), then verify | First broken `seq` reported |

The UI shows each step with timestamps. "Evidence" links open the affected lead, events and sync-history rows.

## 7. CI (GitHub Actions)

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` (as built, T-011: jobs `static` = lint + format + typecheck, `test` = unit + integration on a `postgres:16` service + traceability + artifact `test-reports`, `build` = `pnpm build` with no DB env) | push / PR | `pnpm install --frozen-lockfile` → lint (incl. i18n literal rule, RTL classname ban, boundaries) → typecheck → unit → integration (service `postgres:16`; migrate as owner; tests as `app_user`) → `check-rls` → i18n key parity → build → `traceability` (artifact `docs/traceability.md`) |
| `e2e.yml` | `deployment_status` success on Vercel preview | Playwright against `${{ github.event.deployment_status.target_url }}` (Neon preview branch, seeded via `pnpm db:seed` in the Vercel build for previews); axe; en/ur × 360/1280 screenshots |
| `traceability.yml` | `workflow_dispatch` (from `/traceability`) + nightly | Full unit + integration (+ e2e if `PREVIEW_URL` given) → POST results to `TEST_RESULTS_URL` |
| `neon-pooled.yml` | nightly | Integration suite against a fresh Neon branch via the **pooled** URL |

Secrets: `TEST_RESULTS_URL`, `TEST_RESULTS_SECRET`, `NEON_API_KEY` (branch create/delete), `VERCEL_AUTOMATION_BYPASS_SECRET` (for protected previews).

## 8. Definition of Done: testing gate

A task is done only when:
1. New or changed behaviour has tests **tagged with every requirement ID it implements**, including at least one negative case (unauthorized, cross-tenant, invalid input or failure path).
2. Lead-engine changes keep all `[INV-*]` and `[BASE-*]` tests green. Touching transitions requires a new or updated concurrency test.
3. Integrations: signature + idempotency + failure-path tests with fixtures.
4. UI: strings in both `en.json` and `ur.json`. If the screen is new, it's added to the Playwright RTL/responsive screenshot list and the axe run.
5. `pnpm lint && pnpm typecheck && pnpm test && pnpm traceability` pass locally. `docs/traceability.md` is regenerated and committed.
6. No skipped (`.skip`/`.only`) tests remain, unless they're tracked in `STATUS.md` with a reason.
