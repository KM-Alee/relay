# 14 — Judging Rubric Scorecard (rubric-maxxing plan)

> **Status:** Living document. Source: the organisers' Participant Rubric + Self-Check List (2026-10-18). **This is what we are scored on: 100 points, judged live in the running app.**
> Levels per criterion: **Full 100%** (works end to end, handles bad input, survives refresh) · **Mostly 60%** (one clear gap) · **Partial 30%** (incomplete or only with prepared data) · **None 0%**.
> Ground rules: only what works live counts; criteria 5–8 need the **real** provider (sandbox/test mode OK; a fake caps at Partial); ticking a failing self-check item **lowers criterion 10**.

## 1. Scorecard

Verified by `scripts/verify-selfcheck.ts` against production on 2026-10-18 (raw results: `reports/selfcheck/results.json`).
Status: ✅ verified live on prod · 🟡 built, not yet verified live / one gap · 🔴 missing · Tasks in `09-build-plan.md`.

| # | Criterion (pts) | Self-check items (judges test these) | Our feature / task | Status | Gap to close |
|---|---|---|---|---|---|
| 1 | Roles, permissions, security (10) | Owner can invite users and change roles and permissions in the interface | Invites + roles matrix + overrides (T-103, T-104) | ✅ prod 2026-10-18 (invite via UI; permission change via override API, roles matrix rendered) | Drive a permission toggle in the UI |
| | | Opportunity value hidden without permission, incl. through the API | `core/auth/mask.ts` everywhere (T-102, T-118) | ✅ prod 2026-10-18 | — |
| | | Unauthorized API call rejected; one workspace can't see another | `route()` + `assertPermission` + RLS + 404 (T-002, T-102) | ✅ prod 2026-10-18 | — |
| 2 | Customizable CRM (12) | Custom fields created from the UI appear immediately | T-112 | ✅ prod 2026-10-18 | — |
| | | Two pipelines have different fields; stages added, renamed, reordered | T-111, T-112 | ✅ prod 2026-10-18 (API; UI move-up/down not driven) | Drive reorder in the UI |
| | | A stage blocks a move until required fields are filled | T-113 | ✅ prod 2026-10-18 (API 422 → 200) | — |
| | | A saved list updates automatically; each contact shows full history | T-115, T-116, T-117 | ✅ prod 2026-10-18 | — |
| 3 | Lead assignment + escalation (14) | Leads from web form, incoming message and manual entry | T-122 + WhatsApp→intake glue | 🟡 web form + manual ✅ prod; incoming WhatsApp not verified live | Phone round-trip → lead |
| | | Only Available employees get leads, with a visible countdown | T-121, T-123 | ✅ prod 2026-10-18 | — |
| | | Expired lead escalates once, through levels and times you can configure | T-124 + policy settings form | ✅ prod 2026-10-18 (2-level policy, warp 60×) | — |
| | | On leave/Offline reassigns immediately; recovery queue shows why | **T-125, T-126, T-127, T-128, T-129** | ✅ prod 2026-10-18 | — |
| 4 | Audit log + dashboard (8) | Key actions logged with who, when, before/after; entries can't be edited | T-007, T-151, T-220 | ✅ prod 2026-10-18 | — |
| | | Dashboard figures live, match the records, differ by role | T-150 (metrics repos) | ✅ prod 2026-10-18 (new leads + waiting ack) | Other figures not cross-checked |
| 5 | Messaging (12) | Real message arrives, reply delivered, status updates | T-141, T-146 (webhook registered with Meta) | 🟡 Meta connected + 4 webhook events; needs a human phone test | Live phone round-trip |
| | | Duplicate and forged webhooks handled; failed sends retryable | T-141 | 🟡 local tests only; not re-verified on prod today | Show failure + Retry in UI |
| 6 | Payments (12) | A test payment updates the record automatically | T-143 | 🔴 1 request, 0 paid, 0 Stripe events in current prod data | Pay with 4242 on prod after the reseed |
| | | Webhooks verified and counted once; refunds and failures show | T-143 | 🟡 not verified live today | Refund from the Stripe dashboard |
| 7 | Calendar (10) | Google sign-in works; appointments appear in the real calendar | T-144 | 🟡 needs a human (not_connected) | Human OAuth + booking |
| | | Clashes detected; revoked connection detected; time zones correct | T-144 | 🟡 needs a human | — |
| 8 | Notifications (4) | An escalation sends a real alert with a working link | T-145 + T-124 | ✅ prod 2026-10-18 (Slack postMessage processed) | Link click-through checked by a human |
| 9 | Quality (10) | Secrets out of code and browser; one provider failing doesn't break the platform | Config/secrets, breakers, outbox isolation | 🟡 not re-verified today (/api/health ok on prod) | Judge Console "provider down" scenario (T-209) |
| | | Every screen works on a phone and with a keyboard | T-162 | 🔴 /leads 499px, /contacts 594px, /me 379px overflow at 375px; keyboard not checked | Fix horizontal overflow |
| | | Actions show loading, success and clear error messages | Design system toasts/states | 🟡 error ✅ (bad login), success ✅ (field create); loading not checked | — |
| | | Data survives a restart; timers keep working | Postgres + QStash schedule | 🟡 not re-verified today | Demo: redeploy mid-countdown |
| | | A new person can start the app from the instructions | README quickstart | 🔴 | Rewrite README "Run it in 5 commands" |
| 10 | Demo + understanding (8) | The live demo runs; I tested every ticked item today | Demo script (`12-demo-and-ops.md`), seeded demo workspaces (T-211) | 🔴 | Seed prod demo data; rehearse |
| | | Every member can explain data model, permission checks, escalation timing, webhook handling | `docs/15-how-it-works.md` (team explainer) | 🔴 | Write the explainer |

## 2. Rubric-maxxing phase (after the current lanes merge)

1. **Close 🔴 first, in points order:** lead engine (14) → recovery/absence (part of 14) → glue (messaging→lead, payment link button, Contact 360 history) → phone/keyboard pass + README (10) → explainer + demo data (8).
2. **Live verification pass on production** (Lane Q): walk every self-check item above on https://relay-eta-silk.vercel.app with real phones, Stripe 4242, Google test user, Slack. Record result + date in the table. Only tick what passed.
3. **Bad-input pass** (Full needs it): every form rejects bad input with a clear message; refresh keeps data.
4. **Known limitations table** (self-check last page): keep it honest in §3 below; it goes onto the printed sheet.

## 3. Known limitations (for the self-check sheet; keep honest)

| What does not fully work | What works instead |
|---|---|
| WhatsApp messages **outside the 24-hour window** need Meta-approved templates (submitted, approval pending) | Inside the window, free-text replies work both ways; outside it the send fails visibly with Retry (never silently) |
| WhatsApp test number can only message **registered test recipients** (Meta sandbox rule) | Any registered phone can message in and get replies; forged/duplicate webhooks are rejected/ignored (Judge Console) |
| Older **payment history** on the dashboard chart is seeded demo data | The live Stripe flow (test mode) is real: pay a link with card 4242 → the record turns Paid automatically; refunds/failures update via signed webhooks |
| **Google Calendar** is in Google "Testing" mode: only listed test users can connect, and tokens expire after ~7 days | Connected accounts book real events (visible in Google Calendar), clashes are checked against free/busy, a revoked token shows "Reconnect" |
| **Slack alerts** reach only employees who linked their Slack account | Unlinked employees still get the in-app alert; the skipped Slack alert is recorded with the reason, visible to admins |
| AI stand-in hands off (no AI answer) when a customer asks for a human, is angry, or asks for discounts/prices not in the knowledge base | A polite localized holding message is sent and the human owner is alerted; AI never acknowledges or owns a lead |
| Optional extras not built: first-to-claim pond, skills-based routing, idle re-trigger, event replay | Round-robin assignment with capacity, fallback custody and the full escalation chain work |
| Keyboard-only use is checked on the main flows only | Every page works on a phone; dialogs, menus and forms are keyboard reachable on the main flows |
