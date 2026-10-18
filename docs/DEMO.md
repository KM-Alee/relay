# Hisaab: live demo runbook

**App:** https://relay-eta-silk.vercel.app · **Demo workspace:** Sunrise Solar (Crescent Realty = second workspace for isolation)
**Password for every account:** `Relay-Demo-a3db07fd`

## Accounts and who drives what

| Screen | Login | Role | Used for |
|---|---|---|---|
| **Laptop A** (projector) | `owner@sunrise.test` | Owner, Ayesha | Dashboard, Lead Radar, Recovery, Automations, Team, Audit, Judge Console |
| **Laptop B** (or incognito window) | `user@sunrise.test` | Sales rep, Bilal | Masked values, own leads only, acknowledge, reply |
| **Phone 1** | WhatsApp `0314…4046` | Customer | Sends the WhatsApp lead (allowed test recipient) |
| **Phone 2** | Slack app as Mehboob | Sales rep (linked) | Receives the real Slack alert |
| spare | `owner@crescent.test` | Other workspace | Isolation proof |
| spare | `manager@sunrise.test`, `admin@sunrise.test`, `user2@sunrise.test`, `mehboobulqadri@gmail.com` | | |

Test card: `4242 4242 4242 4242`, any future date, any CVC. Decline: `4000 0000 0000 0002`.

## 15 minutes before

1. Open both laptops logged in (A = owner, B = Bilal). Hard-refresh (Ctrl+Shift+R).
2. Phone 1: send any WhatsApp to **+1 555-066-6010** (opens the 24 h window). Phone 2: Slack notifications ON.
3. Appointments → confirm Google shows **Connected** (reconnect if needed).
4. Automations → time-warp **10×** (so escalations happen in seconds), policy: 2 levels.
5. Judge Console → **Run all** once (warms the app; everything green).

## The script (≈ 7 minutes, rubric order in brackets)

**0. The pitch (20 s):** "Small Pakistani businesses lose customers because leads are answered late or never. Hisaab guarantees every lead has exactly one accountable human, escalates when they're ignored, and an AI stand-in keeps the customer warm in Urdu without ever counting as a response. *AI buys time, humans stay accountable.*"

**1. Overview + Lead Radar (45 s) [4]:** Laptop A Overview: live figures (new leads, first response, recovery queue, payments collected, team availability, pipeline by stage). Click a chip → drill-down list matches the number. Switch to **Radar**: countdown rings on each owner.

**2. A WhatsApp lead, live (90 s) [3, 5]:** Phone 1 sends: *"Assalam o alaikum, 5kW solar ka rate kya hai? DHA Lahore"*.
- Inbox: the message appears (real Meta webhook, signature-verified). A **lead is created with an owner + countdown** (Radar/Leads).
- Wait ~20 s without acknowledging → the **AI stand-in replies in Roman Urdu** on the phone, discloses it's an assistant, answers from the knowledge base. Point out the violet **AI** badge: "AI never acknowledges; the countdown keeps running."

**3. Escalation + Slack (60 s) [3, 8]:** Let the window expire → lead **escalates once** to the next person (escalation count = 1, Radar token moves). **Phone 2 Slack** gets the alert → tap **Open lead** (deep link). Show **Recovery** queue with the reason badges.

**4. Absence + fallback (30 s) [3]:** Team → set a rep **Offline** → their pending leads reassign **immediately**. Automations → show the policy builder (levels + timeouts are configurable).

**5. Human takes over (30 s) [5]:** Laptop B (Bilal) → open the lead → **Acknowledge** (countdown stops) → reply in the thread → arrives on Phone 1 with delivery ticks. Handoff brief shows what the customer wants.

**6. Payment (60 s) [6]:** Contact → opportunity → **Send payment link** (or "$" in the inbox) → open checkout → pay with 4242 → back in Hisaab the request flips to **Paid** by itself (Stripe webhook). Mention: duplicate webhooks counted once; refunds/failures update automatically.

**7. Calendar (30 s) [7]:** Contact → **Book appointment** → pick a slot → appears in the real Google Calendar. Try an overlapping slot → **clash warning**.

**8. CRM customization (45 s) [2]:** Settings → add a custom field → it appears on the contact immediately. Pipeline: drag a deal to a stage with a required field → **blocked until filled**. Saved list updates automatically.

**9. Security (45 s) [1]:** Laptop B (Bilal): deal values show **Hidden** (also through the API). Team → roles matrix: change a permission → applies on the next request. Log in as `owner@crescent.test` → none of Sunrise's data. **Audit log** → who/when/before/after + **Verify integrity**.

**10. Judge Console (30 s) [1, 5, 6, 9]:** Run all → forged/duplicate webhooks, cross-workspace access, provider down, audit tamper: all green. Urdu: switch to `/ur` → full RTL.

**Close (10 s):** "Every lead handed off. None dropped."

## If something fails live
- WhatsApp slow → use the public form `https://relay-eta-silk.vercel.app/f/sunrise-solar` (same engine) and say so.
- AI slow → the static Urdu/English fallback reply is the failure isolation working.
- Escalation not firing → Lead page countdown hits 0 triggers a nudge; or wait for the 2-minute backstop.
- Google token expired → Appointments → Reconnect.

## Team Q&A prep
Everyone reads `docs/15-how-it-works.md` (data model, permission checks, escalation timing, webhook handling, 12 likely judge questions).
