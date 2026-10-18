# Screens and Information Architecture — Relay

> **Status:** Accepted. Derived from `source/DESIGN_GUIDE.md` §04, §08, §11, §13 and mapped onto Relay's requirements. Routes and permission gates: `../07-frontend-i18n.md` §1. Components: `components.md`.
> Reference look: `assets/reference-orange.png` (visual benchmark, **not** pixel spec; its data, "AI Client Overview" title, world map and building art are placeholders and must not be copied literally, per guide §13).

## 1. Global navigation (top only, no sidebar)

```
[✱ Relay]  Overview · Leads · Inbox · Pipeline · Recovery · Automations · More ▾     [Search ⌘K] [🔔 3] [● Available ▾ (avatar)]
More ▾ → Appointments · Payments · Team · Integrations · Audit log · Settings · Judge Console (demo)
```

- **Recovery is top-level**, because it's Relay's core promise (guide suggested `More`; we promote it).
- **Lead Radar** is a tab on Overview (`Summary | Radar`), not a separate destination.
- Destinations the user can't access are not rendered (e.g. a User without `leads.recovery.view` sees no Recovery item).
- Responsive (guide §08): ≥ 1280 full nav · 960–1279 compact labels, overflow to More · 600–959 key items + More · < 600 title + search icon + labelled **Menu** sheet. Key tasks stay within one tap (Acknowledge is always reachable from Notifications).
- RTL: the whole strip mirrors (brand at the right). Chevrons and arrows flip. The search shortcut text stays LTR.

## 2. Overview (`/[locale]`), the homepage

Content order follows guide §04, with **every F5.1 figure visible by default** (requirement wins over the guide's "three cards"; all remain hide-able via F5.5).

```
┌ TopNav ───────────────────────────────────────────────────────────────────────────────┐
│ SAT 18 OCT · 14:03 PKT · SUNRISE SOLAR                      ┌ decorative orange glass ┐│
│ Good afternoon, Hamza                     (text-hero)       │  art (≥960px, alt="")   ││
│ 12 new leads today · 2 need attention     (one sentence)    │ [Revenue at risk  P1]   ││
│ [⏱ 3 waiting acknowledgement ›] [⚠ 2 escalated today ›]      └─────────────────────────┘│
├──────────────┬──────────────┬──────────────┐   ← 3 KpiTiles (role-aware, F5.4)          │
│ New leads    │ Avg first    │ Recovery     │                                          │
│ today   12 ▲ │ response 4m ▼│ queue    5 ▲ │                                          │
├──────────────┴──────────────┴──┬───────────┴──────────────┬───────────────────────┐   │
│ Payments collected (primary)   │ Team availability         │ Open pipeline by stage│   │
│ PKR 1.2M this month  [30 days▾]│ ● 4 Available ● 2 Busy …  │ StageBars (masked?)   │   │
│ line = collected/day, bars =   ├───────────────────────────┴───────────────────────┤   │
│ payments count (separate axis  │ Upcoming appointments (next 5) · Escalations 24h  │   │
│ labels or two plots)           │                                                   │   │
└────────────────────────────────┴───────────────────────────────────────────────────┘
```

| Slot | Figure (Section 9 definitions) | Role variants (F5.4) |
|---|---|---|
| Header sentence | `{newToday} new leads today · {attention} need attention` (attention = pending past window + critical) | User: own leads |
| Chip 1 | Waiting acknowledgement (pending leads in visible scope) → `/leads?state=pending` | |
| Chip 2 | Escalated today (ack-timeout escalations) → `/recovery?reason=escalated` | |
| KPI 1 | New leads today | User: "My new leads" |
| KPI 2 | Average time to first response (first assignment → first ack) | User: own average |
| KPI 3 | Recovery queue items | User: "My overdue" |
| Primary chart | **Payments received this month** (collected revenue trend) | Without value permission → "Leads per day + escalations" chart |
| Secondary 1 | Employee availability (TeamAvailabilityCard) | User: same (team visibility permission) |
| Secondary 2 | Open pipeline value by stage (StageBars) | Values masked without permission |
| Secondary 3 | Upcoming appointments (list) + Escalations (24 h) compact stat | User: own |
| Hero overlay (P1) | Revenue at Risk live ticker, Revenue Rescued this month | Owner/Admin with value permission |

**Radar tab (P1, F5.6):** full-width mission control. Team avatars in a ring or row with availability status rings. Waiting leads are shown as CountdownRing tokens (96 px) attached to their owner. Escalation animates the token to the next owner. Fallback-custody leads sit in a separate "Awaiting handler" lane with the custodian named. Each token is a button that opens the lead drawer. A text list mirror sits below for screen readers.

## 3. Leads (`/leads`) and Inbox (`/inbox`): split view (guide §11)

```
┌ list (360px) ──────────┬ conversation / lead detail ─────────────────┬ inspector (320, ≥1280) ┐
│ [Waiting][Mine][All]   │ Name · source · StatusBadge                  │ Contact fields          │
│ filters / saved lists  │ OwnerChip · CountdownRing · [Acknowledge]    │ AI-collected profile    │
│ LeadRow …              │ ─ thread / timeline ─                        │ Opportunity · payments  │
│                        │ HandoffCard (on takeover)                    │ Appointments            │
│                        │ [owner · countdown · Ack] above Composer     │ Routing trace           │
└────────────────────────┴──────────────────────────────────────────────┴─────────────────────────┘
```
- `< 960`: list → detail as separate views (back button). The inspector becomes a tab.
- **Owner + acknowledgement deadline are always visible near the primary reply/ack button.**
- Leads = all intake records (form, WhatsApp, manual). Inbox = conversation-centric view of the same leads/contacts.

## 4. Pipeline (`/pipeline`)
Board (default) / Table toggle. Pipeline switcher (F2.3). OpportunityCards with keyboard "Move to…" menu. The stage-required-fields dialog interrupts unsafe moves (F2.4). Rotting cards are marked (P1). Value is shown only if permitted.

## 5. Recovery (`/recovery`)
A prioritized **list, not charts** (guide §11). Columns: lead, reason badges (Overdue · Escalated ×2 · Idle · Awaiting handler · Critical), time since window ended, escalation count, current OwnerChip (fallback flagged), **one recommended intervention** button (Reassign / Take over / Claim (P1 pond) / Open). Filters + saved views. Row → lead drawer with the audit timeline. The empty state is a celebratory Lottie (budget item).

## 6. Automations (`/automations`)
RuleSummary guided editor (default) → "Advanced" FlowCanvas (P1) → TestPanel + "Publish". Also lists assignment settings (round-robin/first-to-claim, capacity, windows, retry, idle), teams (backup + manager) and lead sources/forms. Gate: `routing.manage`.

## 7. Customer profile (`/contacts/[id]`)
Headline (name, company, language badge, owner, next action button) → tabs: **Conversations · Opportunities · Payments · Appointments · Activity**. Failures (failed message, expired payment, calendar needs reconnect) surface at the point of action.

## 8. More destinations
| Page | Layout notes |
|---|---|
| Appointments | Week list/agenda. Booking dialog with the free/busy grid. Requires the employee's calendar connected (reason shown otherwise). |
| Payments | Table of payment requests with semantic status badges. Collected vs projected totals separated (I2.6). |
| Team | Availability + open-load counts. Admin: permissions matrix (roles × permissions checkboxes), invites, deactivate. Staff: minimal profile. |
| Integrations | ProviderStatus rows + sync history table + stated limits (I5.6) + AI spend today. |
| Audit log | Filterable table (type/user/date) + "Verify integrity" (P1) with result banner. |
| Settings | Workspace, pipelines & fields, tags, AI & knowledge base, templates, language/time zone/currency. |
| Judge Console | Scenario cards: description · Run · expected vs actual · pass/fail badge · link to evidence (audit/sync history). |
| Profile (`/me`) | Language, theme, sound, Slack link, active sessions. |

## 9. Public web form (`/f/[slug]`)
A standalone, workspace-branded, minimal page: workspace name, short intro, fields, honeypot, submit (primary). The success state explains what happens next. P1: instant booking slots. Mobile-first, RTL-ready, no app nav.

## 10. Auth and onboarding
Sign-in/sign-up as centered cards on `--page-bg` with the Relay wordmark. Onboarding: "Describe your business" single input (P1 AI) **or** pick a template (Real estate / Solar / Clinic) → review proposal (editable list of stages, fields, rules) → Confirm. Loader = Lottie budget item.

## 11. Decorative art policy
- No raster building image in v1. The hero's end side uses a lightweight **SVG of translucent orange "glass" vertical panes** (`--brand` / `--brand-soft` gradients) that fades into `--page-bg`. It is `aria-hidden`, omitted below 960 px, and never carries data.
- Optional industry art per seeded workspace (solar, real estate) is P2 polish (T-228).
- Never put "AI" in a page title unless the feature on that page is AI (guide §13).

## 12. Urdu/RTL screen checks (every screen, Q16)
Mirrored layout via logical properties · Nastaliq never clipped (no fixed-height text boxes) · charts in LTR islands with Urdu labels · phone numbers/amounts/codes isolated LTR (`<bdi>`) · no uppercase/tracking on Urdu eyebrows · icons implying direction flipped (chevrons, arrows, send).
