# 00 — Product Overview

> **Status:** Accepted. Distilled from `requirements.md` v2.2, which stays authoritative. If this doc and `requirements.md` disagree, the requirements win; fix this doc.
> **Read first** if you are new to the project, human or agent.

## 0. Name

**Relay**: like a relay race, a lead is always held by exactly one runner and handed off cleanly; it is never dropped. Tagline: **"Every lead handed off. None dropped."** The internal package scope is `@relay/*` (`@relay/core`, `@relay/db`, `@relay/contracts`, `@relay/web`). The DB is named `relay`. The brief's title ("Unified Business Management Platform") appears only when quoting requirements.

## 1. The idea in one paragraph

Small service businesses in Pakistan (real estate agencies, solar installers, clinics; 5–30 staff) lose customers because leads are answered late or never. The rep was on leave, missed the ping, or nobody noticed. We are building a **WhatsApp-first, accountability-first CRM**. Every incoming lead has **exactly one accountable human at every moment**, escalates automatically when ignored, and is provably traced. While no human is free, an **AI stand-in** keeps the customer warm in their own language (English, Urdu, Roman Urdu, even voice notes), but it never counts as a response. Conversations, Stripe payments and Google Calendar bookings land on the same customer record. Management sees response times, money at risk and money rescued.

**Pitch line:** *"AI buys time, humans stay accountable."*
**Positioning:** big CRMs sell AI copilots; WhatsApp CRMs sell chatbots; **nobody sells provable lead accountability.**

## 2. Who uses it

| Persona | Primary jobs in our app |
|---|---|
| Owner | Signs up (creates the workspace), invites people, sets roles/permissions, watches revenue at risk/rescued, last-resort fallback custodian |
| Admin | Configures pipelines, custom fields, routing and escalation, AI behaviour, integrations, templates |
| Manager (a configurable role, not a hard-coded level) | Watches team availability and the recovery queue, reassigns, default fallback custodian for their team |
| User (sales/support rep) | Gets leads, acknowledges from phone/Slack, chats on WhatsApp (also in Urdu or by voice), logs notes/calls, sends payment links, books appointments |
| Customer (external) | Messages on WhatsApp or fills the public form; gets a fast reply in their language, a payment link and a confirmed slot |

## 3. Core loop (what the demo proves)

```
Customer WhatsApps (Roman Urdu / voice note)  ──►  webhook verified, deduped
   │                                               │
   │   AI stand-in replies in same language  ◄─────┤ (if no human acked within N s / nobody available / after hours)
   │   (discloses it is an assistant; collects     │
   │    name, need, budget …; never acks)          ▼
   │                                    Lead created WITH an accountable human
   │                                    (round-robin over Available + under capacity,
   │                                     else fallback custody: manager/Owner)
   │                                               │ countdown
   │                                               ▼
   │                         ignored → escalation → next eligible → backup → manager
   │                         Slack alert (+AI brief) → "Acknowledge" button
   │                                               │
   ▼                                               ▼
"Hamza has joined the chat"  ◄──── human takes over (handoff card: goal, fields, mood, suggested reply)
   │
   ├─ "$" → Stripe test checkout link over WhatsApp → webhook → "Paid ✓" → Revenue Rescued ticks
   └─ book slot → real Google Calendar event → WhatsApp confirmation in customer's language
Everything → activity timeline + tamper-evident audit chain + live dashboard / Lead Radar
```

## 4. Priorities: how to decide what to build

- **P0 = original problem statement. Must pass. Built and verified first, and must work with every P1/P2 feature switched off** (requirements "Mixed-priority requirements", C20).
- **P1 = committed differentiators** (Lead Radar, AI stand-in, Slack Acknowledge, Urdu/RTL, Judge Console, time-warp, voice notes, revenue metrics, hash chain …).
- **P2 = stretch**, attempted only when all P0 and P1 items pass.

Build order is in `09-build-plan.md` (mirrors requirements §10). When in doubt: **ship the P0 baseline end-to-end before polishing anything.**

## 5. Non-negotiables (the things judges will try to break)

1. A lead is **never ownerless** and **never owned twice**, even with everyone offline, two timers firing together, two people claiming, or a crash mid-countdown.
2. **Server-side authorization** on every endpoint; workspace isolation also enforced by Postgres RLS; guessed IDs get nothing.
3. **Webhooks**: signature-verified on the raw body; duplicates have no effect; failures are visible, never silent.
4. **Real integrations** in free/test modes: Meta WhatsApp Cloud API, Stripe test mode, Google Calendar OAuth, Slack bot, OpenAI. No fakes in the running app.
5. **Timers are persisted** in Postgres and configurable down to seconds (plus time-warp for demos).
6. **AI never acknowledges, never owns, never stops a timer, never takes an irreversible action.** With AI off, everything still works.
7. **Opportunity value is masked** for users without permission everywhere: UI, exports, dashboard, AI, Slack.
8. **Audit history cannot be edited or deleted** by the application's DB role.
9. **Zero cost**: free tiers / sandboxes only; OpenAI is the only paid dependency.

## 6. Constraints and context

- **Deploy:** Vercel (Next.js) + Neon Postgres. No long-running server; see `01-architecture.md`.
- **Twilio waived** (organizer guidance for Pakistan); Meta WhatsApp Cloud API test number instead (C1). Test numbers reach **registered test recipients only**.
- **Stripe** doesn't onboard Pakistani businesses; the test-mode account is created under a supported country. JazzCash and Easypaisa are roadmap only.
- **Google OAuth** app stays in *Testing*: only listed test users, and refresh tokens may be short-lived.
- **Slack** is our chosen notification channel (I4).
- **Languages:** English + Urdu UI (RTL); customer language detection `en` / `ur` / `ur-Latn`.
- **Design:** accepted design system in `docs/design/`: bright, spacious, top-nav-only dashboard, **Warm Orange** accent, Inter + Noto Nastaliq Urdu, light + dark.

## 7. Out of scope (don't build)

Accounting, payroll/shift scheduling, ad analytics, autonomous AI selling, a BI/report builder, training modules, a marketing site, platform billing, email marketing/broadcasts, paid telephony (calls/IVR), JazzCash/Easypaisa, languages beyond en/ur. See requirements §3 and §11.

## 8. Demo (5 minutes)

The script and checklist are in requirements §8 and the runbook in `12-demo-and-ops.md`. Every feature we build should make one moment of that script more convincing. If a task doesn't, question it.
