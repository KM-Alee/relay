# 14 — Judging Rubric Scorecard (rubric-maxxing plan)

> **Status:** Living document. Source: the organisers' Participant Rubric + Self-Check List (2026-10-18). **This is what we are scored on: 100 points, judged live in the running app.**
> Levels per criterion: **Full 100%** (works end to end, handles bad input, survives refresh) · **Mostly 60%** (one clear gap) · **Partial 30%** (incomplete or only with prepared data) · **None 0%**.
> Ground rules: only what works live counts; criteria 5–8 need the **real** provider (sandbox/test mode OK; a fake caps at Partial); ticking a failing self-check item **lowers criterion 10**.

## 1. Scorecard

Status: ✅ verified live on prod · 🟡 built, not yet verified live / one gap · 🔴 missing · Tasks in `09-build-plan.md`.

| # | Criterion (pts) | Self-check items (judges test these) | Our feature / task | Status | Gap to close |
|---|---|---|---|---|---|
| 1 | Roles, permissions, security (10) | Owner can invite users and change roles and permissions in the interface | Invites + roles matrix + overrides (T-103, T-104) | 🟡 | Verify on prod UI |
| | | Opportunity value hidden without permission, incl. through the API | `core/auth/mask.ts` everywhere (T-102, T-118) | 🟡 | Live API check as plain User |
| | | Unauthorized API call rejected; one workspace can't see another | `route()` + `assertPermission` + RLS + 404 (T-002, T-102) | 🟡 | Live cross-workspace check |
| 2 | Customizable CRM (12) | Custom fields created from the UI appear immediately | T-112 | 🟡 | UI polish (D3) |
| | | Two pipelines have different fields; stages added, renamed, reordered | T-111, T-112 | 🟡 | Drag-reorder check |
| | | A stage blocks a move until required fields are filled | T-113 | 🟡 | — |
| | | A saved list updates automatically; each contact shows full history | T-115, T-116, T-117 | 🟡 | Timeline must include messages, payments, appointments, lead events (glue) |
| 3 | Lead assignment + escalation (14) | Leads from web form, incoming message and manual entry | T-122 + WhatsApp→intake glue | 🔴 | Lead engine merging; glue task |
| | | Only Available employees get leads, with a visible countdown | T-121, T-123 | 🔴 | Lead engine merging |
| | | Expired lead escalates once, through levels and times you can configure | T-124 + policy settings form | 🔴 | Lead engine merging |
| | | On leave/Offline reassigns immediately; recovery queue shows why | **T-125, T-126, T-127, T-128, T-129** | 🔴 | Next lead batch |
| 4 | Audit log + dashboard (8) | Key actions logged with who, when, before/after; entries can't be edited | T-007, T-151, T-220 | 🟡 | Ensure every F4.1 action appends (leads, payments, settings) |
| | | Dashboard figures live, match the records, differ by role | T-150 (metrics repos) | 🟡 | Align metric SQL with leads/payments/appointments columns; drill-down counts = figures |
| 5 | Messaging (12) | Real message arrives, reply delivered, status updates | T-141, T-146 (webhook registered with Meta) | 🟡 | Live phone round-trip on prod |
| | | Duplicate and forged webhooks handled; failed sends retryable | T-141 | ✅ (local + prod verify challenge) | Show failure + Retry in UI |
| 6 | Payments (12) | A test payment updates the record automatically | T-143 | 🟡 | "Send payment link" button on opportunity/contact; pay with 4242 on prod → "Paid ✓" live |
| | | Webhooks verified and counted once; refunds and failures show | T-143 | 🟡 | Refund from Stripe dashboard → status shows; fix payment activity insert |
| 7 | Calendar (10) | Google sign-in works; appointments appear in the real calendar | T-144 | 🟡 | Human OAuth on prod + booking |
| | | Clashes detected; revoked connection detected; time zones correct | T-144 | 🟡 | Revoke access in Google → Reconnect shown |
| 8 | Notifications (4) | An escalation sends a real alert with a working link | T-145 + T-124 | 🟡 | Escalation → Slack DM with deep link to `/leads/:id`; "Connect Slack" card i18n bug |
| 9 | Quality (10) | Secrets out of code and browser; one provider failing doesn't break the platform | Config/secrets, breakers, outbox isolation | ✅ | Judge Console "provider down" scenario (T-209) |
| | | Every screen works on a phone and with a keyboard | T-162 | 🔴 | Responsive + keyboard pass on every page |
| | | Actions show loading, success and clear error messages | Design system toasts/states | 🟡 | Audit every form/button |
| | | Data survives a restart; timers keep working | Postgres + QStash schedule | ✅ | Demo: redeploy mid-countdown |
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
| _fill during the verification pass_ | |
