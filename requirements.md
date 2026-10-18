# Unified Business Management Platform: Canonical Requirements

**Version:** 2.2 (canonical; original coverage preserved, ownership and priority conflicts resolved)
**Date:** 18 October 2026
**Based on:** original *Unified Business Management Platform: Problem Statement* (PDF)
**Status:** Working implementation document for the hackathon build, combining the original mandatory baseline with the team's added features. The original PDF remains authoritative for mandatory acceptance criteria, except for documented organizer-approved exceptions. Per the team's report, Twilio is no longer required; Meta WhatsApp Cloud API is the team's replacement choice (C1). Team additions and edge-case policies are documented here and must preserve the original baseline. If another conflict is discovered, preserve the original requirement and record the discrepancy rather than silently overriding it.

---

## 0. Change log from the original problem statement

| # | Change | Reason |
|---|---|---|
| C1 | Twilio is **no longer required**, per the team's report of organizer guidance about availability in Pakistan. Messaging (I1) now targets the team's chosen **Meta WhatsApp Cloud API** (free test number), behind a provider-agnostic adapter. Twilio and Vonage are optional alternate adapters. All original messaging acceptance criteria still apply. | Reported organizer exception for Twilio; Meta is the team's replacement choice |
| C2 | **Zero / near-zero cost constraint** added. Every provider must be usable on a free tier, sandbox or test mode. The only paid dependency allowed is the team's **OpenAI API key**. | Budget |
| C3 | **All AI features use the OpenAI API** (chat, structured outputs, transcription). OpenAI is treated as integration **I6** and inherits the shared integration rules (I5). | Team already has a key |
| C4 | Notifications (I4) fixed to **Telegram bot** (free), with an inline Acknowledge button. | Free, fast, works in Pakistan, interactive |
| C5 | New module **F6: AI Stand-in**. The AI keeps the customer engaged while no human is available, then hands off. It never counts as acknowledgement. | Core differentiator |
| C6 | New module **F7: Localization**. Urdu UI with right-to-left layout, Roman-Urdu and Urdu customer-language matching. | Target market is Pakistan |
| C7 | New module **F8: Voice**. Customer WhatsApp voice-note transcription and employee push-to-talk. | Local usage patterns |
| C8 | New module **F9: AI-assisted CRM**. AI fields, describe-your-business onboarding, natural-language lists, handoff briefs. | Differentiation |
| C9 | F3 extended: first-to-claim mode, skills and capacity routing, escalation policy builder, routing decision trace, acknowledged-but-idle re-trigger (this resolves the open question in F3.6), claimable recovery pond. | Market research (Follow Up Boss, PagerDuty, Salesforce Omni-Channel, Calendly gap) |
| C10 | New module **F10: Demonstrability**. Judge Console (chaos tests), time-warp, requirement traceability page. | Make correctness visible to judges |
| C11 | F4 extended with a **hash-chained, tamper-evident audit log**. | Exceeds F4.3 |
| C12 | F5 extended with **Lead Radar**, **Revenue at Risk** and **Revenue Rescued**, plus stage rot indicators. | Pitch and management value |
| C13 | New quality requirements: Q15 (AI safety and cost), Q16 (internationalization), Q17 (demo polish). | Follows from the new modules |
| C14 | Glossary extended with AI, routing and revenue terms (Section 9). | Consistent definitions |
| C15 | **Implicit requirements made explicit.** The PDF referenced these capabilities without specifying them: user invitations (F1.2), custom roles such as Manager (F1.7), user deactivation and session control (F1.8), tags (F2.1), CSV export (F2.11), CSV import (F2.12), manual activity logging including call logs (F2.13), the public web form (F3.1), and the designated backup (F3.5). | Original text depends on them (F1.3 "export", Q3 "imported content", glossary "call log", F2.6 "tag", Q4 "deleting a user") |
| C16 | Extra items from the research brief: deal health score (F9.6), natural-language rules (F9.4), webhook event replay (I5.9), AI first-reply latency target (F6.13), dark mode and keyboard shortcuts (Q17), deployed demo URL (Q18), demo-day checklist (Section 8). | Research context |
| C17 | Appendix A maps every section and requirement ID of the original PDF to this document. | Proof of complete coverage |
| C18 | Ownership clarified for first-to-claim, exhausted capacity, unavailable teams and exhausted escalation chains (F3.3, F3.5). A named active human retains fallback custody until an eligible employee takes over; ordinary handling assignments still require availability and capacity. | Preserve one accountable owner throughout intake and handoff |
| C19 | Original acknowledgement-timeout escalation metrics retained. Acknowledged-but-idle reassignments remain supported, with their own event type and counter (F3.10, F5.1, Section 9). | Preserve the original metric definitions while keeping the new recovery feature |
| C20 | P0/P1 dependencies clarified: ordinary form submission, in-app acknowledgement, baseline alerts and acknowledged-lead absence handling work independently of instant booking, Telegram buttons, AI briefs and idle re-triggering. | Keep the original baseline independently buildable and testable; retain all added features |
| C21 | Removed blanket precedence over the PDF and corrected Appendix A's glossary coverage claim. | Distinguish the original baseline, reported organizer exceptions and team additions |

**Priority labels used below**

- **P0** = required by the original statement (must pass)
- **P1** = differentiator we commit to
- **P2** = stretch goal, only once all P0 and P1 items pass

**Mixed-priority requirements:** an explicitly labeled P1 or P2 extension inside a P0 row keeps that priority. A reference from P0 to a new feature does not make that feature a prerequisite. P0 acceptance must pass with AI, Lead Radar, instant booking, Telegram acknowledgement buttons and idle re-triggering disabled or not yet built. These remain in the full build at their stated priorities. Clarifications needed to satisfy the original baseline, such as fallback accountability and the visible treatment of acknowledged leads on absence, are P0.

---

## 1. Background and problem

Small and growing service businesses lose revenue because inbound leads are answered late or never. A lead arrives by web form, chat or phone. The employee it was meant for is absent, busy or missed the notification. Nobody notices, and the customer goes to a competitor. The company cannot even see how often this happens, because customer data, conversations, payments, appointments and employee activity are scattered across separate tools that do not share records.

Speed decides the outcome. Widely cited lead-response research (InsideSales/Oldroyd; Harvard Business Review, 2011) found that contacting a lead within 5 minutes made it about 21× more likely to qualify than waiting 30 minutes. Industry surveys repeatedly find only a small minority of companies respond that fast. In the pitch, present these as "studies show" figures.

**Problem to solve:** build one connected web platform where a company:

- manages its customers and sales pipeline,
- **guarantees that every incoming lead is acted on**, and
- talks to customers, collects payments and schedules appointments through real external services,

with every action traceable. When no human is available, the customer is still never ignored.

### What goes wrong today

- Leads are assigned informally, so ownership is unclear and responsibility is easy to dodge.
- Absence, leave and overload are not considered when leads are distributed.
- No one is alerted when a lead has been waiting too long, and no one can later prove who was responsible.
- The CRM forces every company into one fixed structure of fields and stages, so teams keep side spreadsheets.
- Customer conversations, payments and appointments live in other apps, so staff switch between tools and the customer record is incomplete.
- Managers cannot see the true state of the pipeline, the response times or the missed opportunities in one place.
- *(Added)* Customers who message outside working hours or while staff are busy get silence, and leave.
- *(Added)* Tools are English-only and text-only, while local customers write in Roman Urdu and send voice notes.

### What a successful solution achieves

- Every incoming lead has exactly one accountable human owner at any moment, and escalates automatically if ignored.
- *(Added)* While a lead waits for a human, an AI stand-in keeps the customer engaged and collects information, but it never replaces human accountability.
- Each company can shape its own pipeline, fields and rules without developer help, with AI assistance optional.
- Real messages, real payment events and real calendar events appear on the right customer record, with nothing silently lost when an external service fails.
- Access to information depends on the person's role and permissions, enforced on the server.
- Management sees current performance, money at risk, money rescued, and the history of every important action.
- *(Added)* The platform is usable in Urdu and English, and understands customer voice notes.

**Positioning (pitch):** big CRMs sell AI copilots and WhatsApp CRMs sell chatbots. Nobody sells *provable lead accountability*. We are the WhatsApp-first, accountability-first platform for South Asian SMBs. Pitch line: *"AI buys time, humans stay accountable."*

---

## 2. Target users

The platform serves a sales-driven service company with 5 to 30 employees, such as a real estate agency, a solar installer or a clinic's patient-acquisition team. Several companies use the same platform, and each must be completely separate from the others.

| User | Situation | What they need |
|---|---|---|
| Owner | Runs the company and pays for the platform | Control over the workspace, roles and settings; confidence that no lead is wasted; a clear view of revenue, money at risk and performance |
| Admin | Delegated by the Owner to configure the system | Customize pipelines, fields, assignment rules, AI behavior and integrations without code |
| Manager | Supervises a sales or support team | See who is available and which leads are overdue; power to reassign |
| Sales or support employee (User) | Handles leads and customer conversations daily | One place to see assigned leads, reply (including in Urdu, or by voice), record notes, get paid and book appointments; acknowledge from their phone |
| Customer (external) | Contacts the company and expects a prompt reply | A fast response on the channel they used, in their language, a clear payment link and a confirmed appointment |

Owner, Admin and User are the three base levels. A Manager is a configurable role built from permissions, not a fourth hard-coded level.

---

## 3. Scope

The full long-term vision covers about fifteen business modules. This document defines the part that must be solved now: **protecting leads, a customizable CRM, and real connections to external services**, plus the AI, localization and voice layers that make it work for the local market.

| In scope | Out of scope |
|---|---|
| Accounts, workspaces, roles and configurable permissions | Full accounting: ledgers, reconciliation, financial statements |
| Customizable CRM: contacts, companies, opportunities, custom fields (including AI fields), at least one customizable pipeline (multiple supported, F2.3) | Payroll, shift scheduling and legal leave or break rules |
| Lead capture, assignment, acknowledgement, escalation and recovery | Advertising-platform analytics and campaign attribution |
| AI stand-in for customer engagement while no human is available | Fully autonomous AI selling (AI closing deals or taking payment decisions) |
| Audit history of important actions (tamper-evident) | Full report builder and business intelligence |
| Operational dashboard on live data | Training and onboarding modules, AI role-play |
| Urdu/English localization; voice-note transcription | Languages other than Urdu and English (architecture must allow adding them) |
| Real integrations: WhatsApp (Meta Cloud API), Stripe test mode, Google Calendar, Telegram, OpenAI | Public marketing website, billing for the platform itself |
| CSV import and export of CRM records | Email marketing, broadcasts and campaign tools |
| | Paid telephony (voice calling, IVR, "press 1" dispatch); see Section 11 |
| | Local Pakistani payment rails (JazzCash, Easypaisa); roadmap only |

---

## 4. Functional requirements

Each requirement must be true in the running application, using real stored data. **All timers and thresholds must be configurable down to seconds**, so they can be observed during a demonstration (see F10.2 time-warp).

### F1. Accounts, roles and permissions (P0)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F1.1 | Sign up, log in, log out and persistent sessions | Signing up creates a new company workspace and makes the first user its Owner. Refreshing the page keeps the user logged in. |
| F1.2 | Three base levels: Owner, Admin, User | The Owner can invite users and assign levels. An Admin cannot modify the Owner. A User sees only what their permissions allow. **Invitations:** the Owner (or anyone with the invite permission) creates an invite with a level or role. The invite is a single-use link that expires after a configurable time, can be revoked before use, and joins the invited person to that workspace only. Copying the link is the required delivery method; email delivery is optional. |
| F1.3 | Configurable permissions, not tied to role names | The Owner can grant or remove at least: view, create, edit, delete and export for CRM records; manage assignment rules; manage integrations; view the audit log; **manage AI settings** *(added)*. |
| F1.4 | Field-level protection | Opportunity value is hidden or masked for users without the matching permission, in lists, detail pages, exports, **dashboard figures, AI outputs and Telegram alerts** *(added)*. |
| F1.5 | Server-side enforcement | A direct API call by an unauthorized user is rejected. Hiding a button is not sufficient. |
| F1.6 | Workspace isolation | A user of one workspace can never read or change data of another workspace, including through guessed identifiers. Enforced in application code **and** with database row-level security as a second layer *(added)*. |
| F1.7 | Custom roles | The Owner creates named roles (for example "Manager") as bundles of the permissions in F1.3, on top of a base level, and assigns them to users. Manager is a configurable role, never a fourth hard-coded level. Role changes take effect on the user's next request and are audited (F4.1). A seeded "Manager" role exists with: view all leads, reassign, view recovery queue, view team availability. |
| F1.8 | User lifecycle and sessions | Users are **deactivated, never hard-deleted**, so their history and audit entries stay intact (Q4). Deactivating a user ends all their sessions immediately and transfers accountability for all their live leads, including acknowledged leads and fallback custody, to eligible employees or the active fallback owner (F3.5); historical ownership remains recorded. A configured fallback owner cannot be deactivated until an active replacement is designated; the workspace Owner cannot be deactivated without transferring ownership. Each user can see their active sessions and end any of them. The Owner can end all sessions of any user. |

### F2. Customizable CRM (P0)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F2.1 | Contacts, companies and opportunities with relationships | A contact belongs to a company and can have many opportunities. The contact page shows all related records. Contacts and opportunities have an **owner** (assigned employee) and free-form **tags**, which Admins can create, rename and delete. Deleting a tag removes it from records without leaving dangling references. |
| F2.2 | Custom fields created from the interface | An Admin adds a field with a name and a type (text, number, date, dropdown, checkbox) without code. It appears on forms and detail pages immediately. **P1:** the additional **AI field** type follows F9.1. |
| F2.3 | Different fields for different pipelines | Two pipelines show different custom field sets while sharing the same contact information. |
| F2.4 | Stage-specific required fields | Moving an opportunity into a configured stage is blocked, with a clear message, until its required fields are filled. |
| F2.5 | Customizable pipeline | An Admin can add, rename, reorder and delete stages. Deleting a stage that contains opportunities is handled safely (forced move to a chosen stage). Opportunities can be moved between stages on a board or list. |
| F2.6 | Filtering and saved lists | A user combines at least three criteria (field, tag, stage, owner, date), saves the result as a list, and the list updates automatically as records start or stop matching. |
| F2.7 | Activity history | Each contact and opportunity shows a time-ordered log of notes, stage changes, assignments, field edits, messages (**including AI messages, labeled as AI**), payments and appointments, with who and when. |
| F2.8 | Complete customer view | One contact page shows conversations, opportunities, payments, appointments, the assigned employee, the activity history and **the AI-collected profile** *(added)*. |
| F2.9 *(P1)* | Stage rot timers | Each stage can have a rot period. An opportunity with no recorded action for longer than that period is shown in red on the board and feeds the recovery queue (F3.7). |
| F2.10 *(P2)* | "Work this list" mode | From any saved list, a user starts a session that opens each record in turn (next/previous, keyboard shortcuts) until the list is cleared. |
| F2.11 | Export | Users with the export permission (F1.3) can export contacts, companies and opportunities, or any saved list, as CSV. Exports include custom fields, apply the same record visibility as the UI, and **mask opportunity value** for users without the value permission (F1.4). Every export is recorded in the audit log with the actor, the scope and the row count. |
| F2.12 *(P1)* | Import | Users with the create permission can import contacts (and optionally companies) from CSV with a column-to-field mapping screen. Rows are validated on the server (Q3). Invalid rows are reported with reasons, and valid rows import without blocking on invalid ones. Duplicate phone or email numbers are matched to existing contacts rather than duplicated. Imported content is treated as untrusted (escaped on display, no formula execution in later exports). |
| F2.13 | Manual activity logging | On any contact or opportunity, a user can add a **note** or log a **call** (direction, outcome, duration, free-text summary). Both appear in the activity history (F2.7) and count as acknowledgement actions (Section 9). |

### F3. Lead capture, assignment, acknowledgement and escalation (P0, core)

A lead must never be left without an accountable **human**.

**Ownership and fallback custody (P0):** each lead has exactly one active human accountable owner from the transaction that creates it. Normal routing assigns handling responsibility and transfers ownership only to an eligible employee (Available, below capacity and matching any enabled rules). When no eligible handler exists, the designated manager, or the workspace Owner if no active manager is configured, holds **fallback custody**. This is a visibly flagged responsibility to monitor and recover the lead, not an ordinary handling assignment; it does not change that person's availability or bypass handling capacity. The lead records its accountable owner, whether it is awaiting an eligible handler, and the reason. Fallback custody never acknowledges the lead, clears an overdue state or stops retrying routing. The assignment timestamps include the initial human ownership at intake, so waiting for a handler remains visible in response-time metrics. Every transfer is atomic and audited.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F3.1 | Lead capture from multiple sources | Leads are created from a public web form, from an incoming WhatsApp message (I1) and from manual entry, each with a source label. **Web form:** each workspace gets a public form URL and an embeddable snippet. Field choices come from the workspace's custom fields. The form needs no login, is protected against spam (honeypot field plus per-IP rate limit), validates input on the server, creates the lead with an accountable human owner and shows a success confirmation. **P1:** offer instant booking afterwards (I3.8), without making booking or a connected calendar necessary for successful intake. **Manual entry:** source chosen from a configurable list (for example walk-in, phone call, referral). |
| F3.2 | Employee availability | Each employee has a status (Available, Busy, On leave, Offline) that they or an Admin can set and see in the ordinary team and lead views. **P1:** status is also shown live on Lead Radar (F5.6). |
| F3.3 | Configurable assignment rules | An Admin configures at least: (a) **round-robin** among Available employees, and (b) a **maximum number of open leads** per employee. Employees who are not Available or are at capacity never receive ordinary handling assignments. If nobody qualifies, use fallback custody (F3.5), flag the lead as awaiting a handler and retry when availability or capacity changes and on a configurable retry interval. **P1 additions:** (c) **first-to-claim** mode, where eligible employees are alerted while the fallback owner remains accountable; the first valid claim atomically transfers ownership and acknowledges the lead, and losing claims change nothing; an unclaimed lead still follows its acknowledgement deadline and escalation policy; (d) **skill tags** (for example language, area or product) matched against lead attributes; (e) **per-employee capacity** in place of one global maximum. |
| F3.4 | Acknowledgement window | The assignee receives an in-app notification (a notification centre with unread count, plus an optional sound cue) and a Telegram alert, and must acknowledge or act within a configurable time. The remaining time is visible as a countdown. An in-app **Acknowledge** action and the recorded human actions in Section 9 work independently of AI and Telegram buttons. **P1:** acknowledging from the Telegram inline button (I4.5) also counts as a human acknowledgement. |
| F3.5 | Escalation chain | When the window expires, the lead moves to the next eligible employee, then to a designated backup, then to a manager. The number of levels and the time allowed per level are configurable through a basic settings form. **Backup:** each team or pipeline has a designated backup person and a manager, set by an Admin. Unavailable, at-capacity or inactive handling targets are skipped, with the reason recorded. **Fallback:** the active designated manager, or otherwise the workspace Owner, remains the accountable custodian whenever no eligible handler exists, including at intake, during first-to-claim and after absence reassignment. **End of chain:** the policy repeats a configurable number of times; once exhausted, fallback custody continues, the lead is flagged critical, and it appears at the top of the recovery queue. The fallback owner receives an in-app and Telegram alert even if currently unavailable, without being treated as an eligible handler. Eligibility retries continue; ownership never becomes null. An expired window with no actual owner transfer is recorded as an overdue routing attempt, not another escalation. **P1:** a visual **escalation policy builder** in the style of PagerDuty, with ordered levels, each with a target and a timeout. |
| F3.6 | Reassignment on absence | Setting an employee to On leave or Offline immediately reassigns their **unacknowledged** leads to an eligible employee or fallback custody (F3.5). **P0 treatment of acknowledged leads:** they stay with the owner, remain visible to managers and enter the recovery queue when the existing idle-period criterion is met (F3.7); a manager can manually reassign them. A banner explains that the owner is absent and which rule applies. **P1:** when acknowledged-but-idle re-triggering (F3.10) is implemented and enabled, it additionally automates reassignment after its configured timeout; otherwise the P0 behavior remains fully functional. Deactivation follows F1.8 rather than retaining an inactive accountable owner. |
| F3.7 | Recovery queue | One page lists leads that are unacknowledged beyond their window, escalated two or more times, or untouched for a configurable idle period, with the reason shown for each. Awaiting-handler and exhausted-chain critical leads are also shown with their accountable fallback owner; the three original inclusion criteria remain independently active. **P1:** the queue works as a *claimable pond*; an eligible Available employee below capacity can claim a lead from it, which atomically transfers ownership and acknowledges it in one action (audited). |
| F3.8 | No duplicate action | A lead is never owned by two people at once, and two timers expiring close together never escalate the same lead twice. Implemented with a stored `escalate_at`, a worker, and a conditional update on a `version` column. This must survive a server restart. |
| F3.9 | External notification of escalations | When a lead escalates, the new owner is also alerted outside the application through Telegram (I4). |
| F3.10 *(P1)* | Acknowledged-but-idle re-trigger | If an acknowledged lead has no recorded human action within a configurable time, it re-enters the routing chain for reassignment (in the style of PagerDuty's acknowledgement timeout), using F3.5 fallback custody if needed. The transfer is recorded as an **idle re-trigger reassignment**, with its own reason and counter; it does not increment the original acknowledgement-timeout escalation counter. A new handler must acknowledge within a fresh window; later expiry of that window is an ordinary escalation if it causes reassignment. The first-ever assignment and first acknowledgement timestamps remain unchanged for response-time and Revenue Rescued calculations. |
| F3.11 *(P1)* | Routing decision trace | Every assignment stores and shows *why* it happened, for example: "Skipped Ali (On leave); skipped Sara (5/5 open leads); assigned Hamza (round-robin, next in rotation)." The trace is visible on the lead and recorded in the audit log. |
| F3.12 *(P1)* | Urgency-based windows | Leads marked urgent (manually, or by AI triage in F6.6) use a shorter acknowledgement window, configurable per workspace. |

### F4. Audit history (P0)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F4.1 | Record of important actions | Assignment, acknowledgement, escalation, reassignment, role or permission changes, field or pipeline configuration changes, integration connection changes, deletions, **AI stand-in start, stop and handoff, and AI setting changes** are recorded with actor (user, system or AI), time, target and before/after values where relevant. |
| F4.2 | Restricted visibility | Only users with the audit permission can open the history. It can be filtered by event type, user and date. |
| F4.3 | Tamper resistance | No screen or endpoint allows editing or deleting history entries. The database role used by the application cannot UPDATE or DELETE audit rows (enforced by a trigger or grants). |
| F4.4 *(P1)* | Hash chain | Each audit entry stores a hash of its contents plus the previous entry's hash. A "Verify integrity" action recomputes the chain and reports the first broken link, if any. |

### F5. Operational dashboard (P0)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F5.1 | Live overview | The dashboard shows at least: new leads today, open pipeline value by stage, average time to first response, items in the recovery queue, escalations in the last 24 hours, employee availability, upcoming appointments and payments received this month. **Escalations** uses the original acknowledgement-timeout definition in Section 9. **P1:** idle re-trigger reassignments have a separate labeled figure and drill-down; they are never silently added to the original count or its recovery-queue threshold. |
| F5.2 | Consistent definitions | Every figure follows the definitions in Section 9 and matches the underlying records when opened. |
| F5.3 | Drill-down | Clicking at least three figures opens the filtered list of records the user is allowed to see. |
| F5.4 | Role-aware view | A User sees personal figures (own leads, own response time). Owner and Admin see company-wide figures. |
| F5.5 | Basic customization | A user can show or hide figures and the choice is remembered. |
| F5.6 *(P1)* | Lead Radar | A live "mission control" view: team avatars with status rings; each waiting lead shown with a countdown ring (green, amber, then red and pulsing); escalation animates the lead moving to the next owner. Updates in real time with no refresh. |
| F5.7 *(P1)* | Revenue at Risk | A live figure (Section 9) of value currently waiting for human acknowledgement. It ticks up while leads wait, with drill-down. |
| F5.8 *(P1)* | Revenue Rescued | Collected revenue this month from leads that escalated at least once before being acknowledged (Section 9). |
| F5.9 *(P1)* | AI stand-in stats | Conversations held by the AI, median AI-held duration, and number of handoffs. Shown to Owner and Admin. |

### F6. AI Stand-in: customer engagement while no human is available (P1, new)

**Principle:** the AI keeps the customer warm and collects information. **It never counts as acknowledgement, never owns a lead, and never stops the escalation timer.**

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F6.1 | Modes | Per workspace (and optionally per pipeline): **Off**, **Suggest** (the AI drafts replies and a human sends them), or **Stand-in** (the AI replies automatically when the trigger conditions in F6.2 are met). Changing mode is permission-gated and audited. |
| F6.2 | Trigger conditions | Stand-in activates when any of these is true for an incoming customer message: the lead is unacknowledged for more than N seconds (configurable, can be 0); no eligible employee is Available; or the message is outside configured business hours. |
| F6.3 | Disclosure | The first AI message in a conversation states that the customer is talking to the company's assistant and that a person will join, for example: "I'm the Sunrise Solar assistant; Hamza from our team will join shortly." Every AI message is labeled **AI** in the conversation view and activity history. |
| F6.4 | Information collection | The AI asks the qualifying questions configured by the Admin (default: name, need, location, budget, preferred contact time) and writes answers into the matching custom fields, marked "filled by AI". It never overwrites a value a human entered. |
| F6.5 | Grounded answers only | The AI answers only from a workspace knowledge base the Admin edits (services, service areas, hours, FAQs) and from the contact's own record. If the answer is not there, it says a team member will answer. |
| F6.6 | Triage | For each inbound message the AI produces structured output (OpenAI structured outputs / JSON schema): language, intent (for example buy, price, booking, complaint, other), urgency, sentiment and a one-line summary. Urgent or angry messages set the lead to urgent (F3.12). |
| F6.7 | Honest status | The AI may tell the customer the true status from the escalation engine ("Hamza has been notified"). It never invents names or times. |
| F6.8 | Forbidden actions | The AI must never: quote prices not in the knowledge base; promise discounts; confirm or cancel bookings by itself; send payment links by itself; message opted-out contacts (I1.9); or reply outside the WhatsApp 24-hour service window (template messages only, and only if configured). |
| F6.9 | Hard handoff triggers | If the customer asks for a human, expresses anger or a complaint, or the AI's confidence is low, the AI sends a short holding message, stops asking questions, and flags the lead urgent. |
| F6.10 | Human takeover | The moment a human acknowledges or sends a message, Stand-in stops for that conversation. The employee sees a **handoff card**: customer goal, collected fields, sentiment, conversation summary and a suggested first reply in the customer's language. The customer receives "Hamza has joined the chat" (in their language). |
| F6.11 | Failure isolation | If OpenAI is slow or down, the lead flow (capture, assignment, escalation, alerts) continues unaffected. The AI is skipped and a static, localized fallback auto-reply is sent instead (configurable). The failure is shown on the integrations page (I5.1). |
| F6.12 | Auditability | Stand-in start, every AI message, handoff, and the reason for stopping are recorded (F4.1). The prompt version used is stored with each AI message. |
| F6.13 | Latency target | The first AI reply reaches the customer within about 5 seconds of the inbound webhook under demo conditions (target: about 3 seconds). The webhook is acknowledged to the provider immediately and the AI reply is produced asynchronously, so slow AI never causes the provider to retry. |

### F7. Localization (P1, new)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F7.1 | UI languages | The full interface is available in **English and Urdu**. Each user chooses a language, saved to their profile. All UI strings live in translation files; no hard-coded strings. |
| F7.2 | Right-to-left layout | When Urdu is active, `dir="rtl"` is set and the layout mirrors correctly using CSS logical properties. Icons that imply direction are flipped. Numbers, phone numbers and code stay left-to-right where appropriate. |
| F7.3 | Typography | Urdu uses a Nastaliq font (for example Noto Nastaliq Urdu) with increased line-height so text is never clipped. |
| F7.4 | Formatting | Dates, times, numbers and currency use `Intl` with locale `ur-PK` or `en-PK` (or the user's choice). PKR is supported as a currency option alongside the Stripe test currency. |
| F7.5 | Customer language matching | For each conversation the platform detects whether the customer writes in **Urdu script, Roman Urdu or English**, stores it on the contact, and the AI stand-in, suggested replies and handoff confirmations use the same language and script. |
| F7.6 | Localized templates | Auto-replies, payment-link messages, booking confirmations and the AI disclosure exist per language. The Admin can edit them. |
| F7.7 | Extensibility | Adding a third language requires only new translation files and templates, with no code changes. |

### F8. Voice (P1/P2, new)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F8.1 *(P1)* | Customer voice notes | An inbound WhatsApp voice note is downloaded through the provider's media API, stored, transcribed (OpenAI transcription, I6), and shown as a playable audio bubble with its transcript and a one-line summary underneath. |
| F8.2 *(P1)* | Voice notes feed AI and triage | Transcripts are treated as message text for the AI stand-in (F6), triage (F6.6), contact matching and lead capture. |
| F8.3 *(P1)* | Transcription failure handling | If transcription fails, the audio stays playable, the message is marked "transcription failed", and it can be retried. Nothing blocks the lead flow. |
| F8.4 *(P2)* | Employee push-to-talk | In the conversation composer and the note editor, a mic button records audio in the browser (MediaRecorder), transcribes it, and inserts the text for review before sending or saving. Works in Urdu and English. |
| F8.5 *(P2)* | Voice commands | From the command bar, a spoken command (for example "assign this to Hamza", "book Thursday 3 pm") is transcribed, parsed into a structured action, **shown for confirmation**, and executed only after the user confirms. |

### F9. AI-assisted CRM (P1/P2, new)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F9.1 *(P1)* | AI field type | An Admin creates a custom field of type "AI field" with an output type (text, dropdown, number) and a prompt, for example "Lead intent: Buy / Rent / Browsing". The field fills itself from the contact's conversation and notes, shows "AI" and a timestamp, and can be overridden by a human (a human value always wins). |
| F9.2 *(P1)* | AI handoff brief in alerts | Escalation alerts (Telegram, I4) and handoff cards include a two-line AI summary when available: what the customer wants, their mood, and a suggested reply. If AI is disabled, slow, over budget or unavailable, send the baseline alert on time with the lead context required by I4.2; do not wait for generation. The handoff card still shows known customer fields and recorded conversation context. Opportunity values are masked according to F1.4. |
| F9.3 *(P1)* | Describe-your-business onboarding | During workspace setup the Owner can type one sentence (for example "solar installer in Lahore, 8 sales reps"). The AI proposes pipeline stages, custom fields, stage-required fields, assignment rules and knowledge-base starter entries. The Owner reviews and edits; **nothing is applied until confirmed**. Built-in templates exist for Real estate, Solar and Clinic as a no-AI fallback. |
| F9.4 *(P2)* | Natural-language command bar | Ctrl/Cmd+K opens a command bar. Typing a request such as "solar leads over 500k stuck in Proposal more than 3 days" produces a filter. The generated criteria are **shown as editable filter chips** before saving as a list (F2.6). The server validates the filter against the user's permissions. **Natural-language rules (P2):** an Admin types a request such as "escalate WhatsApp leads after 2 minutes" or "send solar leads over 1M to senior reps". This produces a proposed assignment or escalation rule, shown in the normal rule editor for review, and saved only on confirmation (audited). |
| F9.5 *(P2)* | Suggested replies | In any conversation, a user can request 2–3 suggested replies in the customer's language, grounded in the knowledge base and contact record. |
| F9.6 *(P2)* | Deal health score | Each open opportunity card shows a health indicator (good, at risk or stalled), with a one-line reason and a suggested next action. It is computed from transparent signals (days in stage compared with the workspace median for that stage, time since last activity, customer sentiment from F6.6, payment-link status), with an optional AI-written explanation. The rules-based score must work with AI switched off. |

### F10. Demonstrability (P1, new)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F10.1 | Judge Console | An Owner-only page (available in demo mode) with buttons that trigger real failure scenarios against real code paths: replay a webhook twice (I1.8, I2.4); send a forged-signature webhook (I1.2, I2.3); fire two escalation timers at the same moment (F3.8); restart the worker mid-countdown (Q5); request another workspace's record by ID (F1.6); simulate a provider outage (I5.8). Each shows the expected and actual result. |
| F10.2 | Time-warp | A workspace-level clock multiplier (for example 1×, 10×, 60×) that scales all lead timers, so a 15-minute window plays out in 15 seconds. Clearly labeled when active and audited. |
| F10.3 | Requirement traceability page | Lists every requirement ID in this document with its automated test, last run time and pass/fail status. Tests can be re-run from the page in demo mode. |
| F10.4 | Seeded demo workspaces | Two seeded workspaces (for example "Sunrise Solar" and "Crescent Realty") with realistic sample data, to demonstrate isolation and dashboards. |

---

## 5. Integrations

A business platform is only useful if it works with the services a company already uses. The solution must connect to real external services in their **free, sandbox or test modes**, not to fake or hard-coded stand-ins. Each external service has its own authentication scheme, event format, failure behavior and limits, and the solution must handle them correctly.

**Mandatory set (unchanged in structure from the PDF):** messaging (I1), payments (I2) and calendar (I3) are mandatory, and one notification channel (I4) is chosen by the team. The PDF accepted Slack, Telegram or transactional email for I4; **we choose Telegram**. AI (I6) is our addition and is not part of the mandatory set.

| ID | Integration | Provider (free mode) | Business purpose |
|---|---|---|---|
| I1 | Messaging | **Meta WhatsApp Cloud API**, using the free test number and registered test recipients. Optional alternate adapters: Twilio WhatsApp Sandbox, Vonage Messages Sandbox. | Talk to customers and capture leads from incoming messages |
| I2 | Payments | **Stripe test mode** | Collect payments for opportunities and see their status on the customer record |
| I3 | Calendar | **Google Calendar via OAuth 2.0** (app in Testing status, listed test users) | Book appointments with customers on employees' real calendars |
| I4 | Notifications | **Telegram Bot API** | Alert employees outside the app when a lead escalates; allow acknowledgement from Telegram |
| I5 | Shared rules | — | Requirements every integration must satisfy |
| I6 | AI | **OpenAI API** (team's own key; the only paid dependency) | Stand-in, triage, AI fields, summaries, transcription, onboarding |

### I1. Messaging (Meta WhatsApp Cloud API)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I1.0 | Provider adapter | All messaging goes through a `MessagingProvider` interface (send text, send template, send media, verify webhook, parse inbound, parse status, download media). The Meta adapter is required; other adapters are optional. The provider is chosen per workspace on the integrations page. |
| I1.1 | Receive messages | A message sent from a real phone to the test number reaches the platform through the webhook and appears in a conversation view. The webhook supports Meta's GET verification handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`). |
| I1.2 | Request authenticity | Every webhook POST is verified with `X-Hub-Signature-256` (HMAC-SHA256 of the **raw** body with the app secret, compared in constant time). A forged or altered request is rejected and recorded in the sync history. |
| I1.3 | Send messages | An employee replies from the platform and the customer receives it on their phone. |
| I1.4 | Delivery status | Sent, delivered, read and failed states from status webhooks are stored and shown on each message. |
| I1.5 | Contact matching | A message from a known number attaches to the existing contact. A message from an unknown number creates a contact and a lead (F3.1). |
| I1.6 | Ownership | Each conversation shows its assigned employee and is visible only to users permitted to see it. |
| I1.7 | Failure handling | If the provider rejects a send or is unreachable, the message stays visible as failed with the reason, and the employee can retry. Nothing is silently dropped. |
| I1.8 | Duplicates | A webhook delivered twice does not create two messages or two leads (unique constraint on the provider message ID, for example the WhatsApp `wamid`). |
| I1.9 | Opt-out | A contact marked opted-out cannot be messaged by humans or the AI, and the interface explains why. |
| I1.10 | 24-hour service window | The UI shows whether the conversation's free-text window is open. Outside the window, free text is blocked with an explanation, and only approved templates can be sent. |
| I1.11 | Media | Inbound audio, images and documents are downloaded through the media API, stored, and shown in the thread (needed for F8.1). |

### I2. Payments (Stripe test mode)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I2.1 | Create a payment request | From an opportunity, an employee creates a Checkout Session or Payment Link for a stated amount and currency and can send it to the customer. **P1:** also offer this directly from the conversation view (a **"$" button**) and send the link over WhatsApp in the same thread. |
| I2.2 | Payment confirmation by webhook | Completing a test payment updates the opportunity's payment status without any manual refresh, driven by the webhook. A "Paid ✓" event appears in the conversation thread. |
| I2.3 | Request authenticity | Webhooks are verified with Stripe's signature (`Stripe-Signature`, endpoint secret) before any record changes. |
| I2.4 | Idempotent processing | The same event received more than once records the payment once (unique on Stripe event ID). |
| I2.5 | Other outcomes | Expired, abandoned and failed payments are shown with the correct status. A refund made in the Stripe dashboard is reflected in the platform. |
| I2.6 | Collected versus expected | The platform separates collected revenue from projected or unpaid amounts. The dashboard (F5.1) uses collected revenue only. |
| I2.7 | Traceability | Each payment shows the opportunity, contact, employee who requested it and the Stripe reference. |
| I2.8 | No card data stored | The platform never stores or logs card numbers. Payment details are entered only on Stripe's hosted page. |

> **Constraint note:** Stripe does not currently onboard Pakistan-based businesses. Create the **test-mode** account under a supported country; no business verification is needed for test mode. Confirm this before the build. JazzCash and Easypaisa are roadmap items only.

### I3. Calendar (Google Calendar, OAuth 2.0)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I3.1 | Connect with consent | An employee connects their own Google account through the OAuth 2.0 consent flow, and can disconnect it. |
| I3.2 | Token handling | Access tokens are refreshed automatically and stored only on the server (encrypted at rest). A revoked or expired connection is detected and shown as needing reconnection. |
| I3.3 | Create appointments | From an opportunity, contact or conversation, an employee books an appointment that appears in their real Google Calendar and on the customer record. |
| I3.4 | Avoid conflicts | The booking screen reads busy times (free/busy) and prevents or warns about overlaps. |
| I3.5 | Time zones | Times display correctly for the employee and are stored unambiguously (UTC plus IANA time zone), including across time zones. |
| I3.6 | Change and cancel | Rescheduling or cancelling in the platform updates the Google event and is recorded in the activity history. |
| I3.7 | Availability link | Calendar connection status is visible to Admins. An employee without a connected calendar cannot be booked, and the reason is shown. |
| I3.8 *(P1)* | Instant booking after web form | After the public web form (F3.1) is successfully submitted, the thank-you screen shows the eligible assigned handler's real free slots, and the customer can book one immediately. If the lead is in fallback custody, no handler has been assigned, no calendar is connected or Google is unavailable, keep the successful intake confirmation and explain that a team member will arrange a time. Do not expose the fallback custodian's calendar merely because they hold accountability. |
| I3.9 *(P1)* | Localized confirmation | A booking confirmation is sent to the customer over WhatsApp in their language (F7.6). |

### I4. Notifications (Telegram bot)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I4.1 | Real delivery | When a lead escalates (F3.5), the new owner receives a Telegram message within the same minute. |
| I4.2 | Useful content | The alert names the lead, the source, the reason for escalation and a link that opens the lead. **P1:** include the AI handoff brief (F9.2) when available. AI being disabled, slow or unavailable never delays or prevents the baseline alert; it can carry the latest recorded human-readable context instead. |
| I4.3 | Per-user routing | Each employee links their own Telegram chat through a one-time deep link (`/start <token>`) from their profile page. The chat ID is stored server-side. |
| I4.4 | Failure handling | A failed alert is recorded, retried a limited number of times with backoff, and visible to Admins. |
| I4.5 *(P1)* | Acknowledge from Telegram | The alert carries an inline **Acknowledge** button. Pressing it (verified as the linked user and the current owner) acknowledges the lead, edits the Telegram message to show the result, and is recorded in the audit log. A stale button (lead already reassigned) responds with an explanation and changes nothing. |

### I6. AI (OpenAI API) (new)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I6.1 | Server-side only | All OpenAI calls are made from the server. The API key never reaches the browser. |
| I6.2 | Model configuration | Models are set by environment variables per task (chat/triage, transcription). The default is the cheapest current small chat model and the cheapest current transcription model that handles Urdu acceptably. Confirm current model names and prices from OpenAI's documentation at build time. |
| I6.3 | Structured outputs | Triage, AI fields, onboarding proposals and natural-language filters use JSON-schema structured outputs, validated on the server before use. Invalid output is rejected and logged. |
| I6.4 | Cost controls | A per-workspace daily token or spend cap. When the cap is reached, AI features degrade gracefully (Stand-in falls back to static replies) and Admins are notified. Token usage is logged per call. |
| I6.5 | Logging | Each AI call is an integration event (I5.4): time, task, model, tokens, latency, result and prompt version. No secrets are logged. |
| I6.6 | Data minimization | Only the data needed for the task is sent. Opportunity values are not sent to AI tasks that do not need them. Card data never exists in the system (I2.8). |
| I6.7 | Timeouts and retries | Every call has a timeout. Temporary errors retry with backoff (I5.5). The lead flow never waits on AI (F6.11). |

### I5. Requirements shared by every integration (I1–I4, I6)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I5.1 | Central integrations page | One page lists each integration with its status (not connected, connected, error), when it last worked, its recent errors and **AI spend today** *(added)*. |
| I5.2 | Per-workspace configuration | Each workspace supplies its own credentials or connection. One workspace's connection is never used by another. |
| I5.3 | Secret handling | API keys, tokens and signing secrets are never sent to the browser, never committed to the repository, never shown in full in the interface, and are encrypted at rest. |
| I5.4 | Synchronization history | Every inbound event and outbound call is recorded with time, result and a reference, and can be reviewed by authorized users. |
| I5.5 | Resilience | Temporary provider errors are retried with a delay. Permanent errors are shown to a user with a plain explanation. |
| I5.6 | Clearly stated limits | The interface states what each integration can and cannot do (for example: WhatsApp test numbers reach only registered test recipients; the 24-hour window; the Google test-user restriction; the AI daily cap). |
| I5.7 | Permission and audit | Only users with the integration permission can connect, change or remove an integration, and each change is recorded in the audit history. |
| I5.8 | Isolation of failures | If one provider is unavailable, the rest of the platform keeps working. |
| I5.9 *(P1)* | Event replay | From the synchronization history, an authorized user can replay a recorded inbound event (for example a missed Stripe or WhatsApp webhook after an outage). Replays go through the same verification and idempotency path, so replaying an already-processed event changes nothing and says so. Replays are audited. |

### Provider constraints to plan for

Confirm each of these against the provider's current documentation, because they change.

| Provider | What is needed | What to expect |
|---|---|---|
| Meta WhatsApp Cloud API | Meta developer account, an app with WhatsApp added, the test phone number, app secret, a verify token | Messages only reach registered test recipients; free-text replies only within 24 hours of the customer's last message, templates outside it |
| Twilio WhatsApp Sandbox (optional) | Twilio trial account | Phones must join with a join phrase; shared sandbox number; joins expire after about 3 days |
| Stripe test mode | Stripe account (test mode) registered under a supported country | Published test card numbers; webhook secret issued per endpoint |
| Google Calendar | Google Cloud project, Calendar API enabled, OAuth consent screen | An app in Testing status accepts only listed test users and may issue short-lived refresh tokens |
| Telegram | A bot token from BotFather | Its own message format, rate limits and error codes; users must start the bot before it can message them |
| Slack or transactional email (alternatives accepted by the PDF for I4) | A free workspace bot, or a free email-provider account and API key | Each has its own message format, rate limits and error codes; not used unless Telegram is dropped |
| OpenAI | API key with billing | Pay per token; rate limits by tier; model names change over time |
| All webhooks | A publicly reachable HTTPS address | Local development needs a tunnel (for example Cloudflare Tunnel or ngrok) or a deployed address |

---

## 6. Quality requirements

These apply to everything in Sections 4 and 5. They describe how well the platform must behave, and they are where core web development skill shows.

| ID | Area | Requirement |
|---|---|---|
| Q1 | Authentication security | Passwords are stored only as salted hashes from a recognized algorithm (argon2id or bcrypt). Sessions or tokens expire and can be ended. Login is rate-limited against repeated guessing. |
| Q2 | Authorization | Every endpoint checks the caller's workspace and permission on the server. Identifiers in URLs cannot be used to reach other users' or other workspaces' data. |
| Q3 | Input safety | All input is validated on the server. The application is protected against injection, cross-site scripting and cross-site request forgery. Uploaded or imported content, **AI output and transcripts** are never trusted. |
| Q4 | Data integrity | Deleting or changing a stage, field, user or contact never leaves orphaned or contradictory data. Concurrent edits do not silently overwrite each other (optimistic locking with a version column). |
| Q5 | Concurrency and timing | Assignment, escalation and webhook handling stay correct when events arrive at the same time or more than once, and when the server restarts while timers are running. Timers are persisted, never held only in memory. |
| Q6 | Persistence | All data lives in a real database (PostgreSQL) and survives restart. Configuration made through the interface is stored per workspace. |
| Q7 | Responsive interface | Every screen is usable on a phone, a tablet and a laptop without horizontal scrolling or hidden controls, **in both LTR and RTL**. The app is installable as a PWA so employees can acknowledge from their phone. |
| Q8 | Accessibility | Interactive elements are keyboard-usable, forms have labels, color is never the only carrier of meaning (countdown rings also show numbers), contrast is readable, and `lang` and `dir` attributes are correct. |
| Q9 | Performance | Lists with several hundred records use pagination or equivalent. Search and filters respond without freezing the interface. Slow operations (AI, transcription) show progress while the user keeps working. |
| Q10 | Feedback and errors | Every action shows loading, success and failure states. Error messages say what went wrong and what the user can do, in the user's language. |
| Q11 | Real-time awareness | New leads, escalations, incoming messages, AI stand-in activity and payments appear without a manual page refresh (WebSocket or SSE). |
| Q12 | Consistent data | The same figure shows the same value on every screen, because all screens read the same records and Section 9 definitions. |
| Q13 | Configuration and secrets | Settings and secrets are kept outside the source code (`.env`, with a committed `.env.example`). A new person can start the application from written instructions and seed data with one command (Docker Compose). |
| Q14 | Maintainable structure | The code separates business rules, data access, integrations (provider adapters) and presentation, so that a provider or rule can change without rewriting the application. |
| Q15 *(new)* | AI safety and cost | AI behavior follows F6.3–F6.9. Prompts are versioned in the repository. AI never takes irreversible actions without human confirmation. Spend is capped (I6.4). With AI switched off, the platform is fully functional. |
| Q16 *(new)* | Internationalization | No hard-coded UI strings. All user-facing dates, numbers and currency go through locale-aware formatting. RTL is tested on every screen. |
| Q17 *(new)* | Demo polish | Meaningful motion only: layout animations on the board, number tickers on the dashboard, and at most about 5 Lottie animations (payment received, integration connected, empty recovery queue, AI onboarding loader). Optional sound cues (new lead, escalation, payment) can be muted. Skeleton loaders and optimistic UI with rollback. Light and dark themes (following system preference by default). Keyboard shortcuts for frequent actions (acknowledge, next lead, open command bar, move stage), listed on a shortcut help screen. |
| Q18 *(new)* | Cost and deployment | Everything runs on free tiers, sandboxes or test modes, except OpenAI usage. Hosting uses a free tier or a single small server; the database is local or on a free managed tier. For the demo, the app runs at a **stable public HTTPS URL** (deployed, or a persistent tunnel) registered with every webhook provider, so it does not depend on a tunnel URL that changes on restart. |

---

## 7. Suggested architecture (non-binding)

- **Frontend:** React/Next.js, Tailwind, Framer Motion, an i18n library with RTL support, and a Cmd+K command palette.
- **Backend:** one API service plus one **worker** process for timers, retries and outbound jobs. The database is the source of truth for timers: `escalate_at` timestamps polled with `SELECT … FOR UPDATE SKIP LOCKED`, and conditional updates on `version`.
- **Database:** PostgreSQL with row-level security on workspace-scoped tables. Unique constraints for webhook idempotency (`provider`, `external_event_id`).
- **Realtime:** WebSocket or SSE channel per workspace.
- **Adapters:** `MessagingProvider` (Meta, optional Twilio and Vonage), `PaymentProvider` (Stripe), `CalendarProvider` (Google), `Notifier` (Telegram), `AIProvider` (OpenAI).
- **Outbox pattern:** domain events are written in the same transaction as state changes; the worker delivers alerts and messages from the outbox.

---

## 8. Demo script (5 minutes, target)

**Demo-day checklist (before going on stage)**

- [ ] Judges' and teammates' WhatsApp numbers added as test recipients in Meta, with a QR code or `wa.me` link to the test number on the slide.
- [ ] Every teammate's Telegram is linked to the bot; Google test users added; Google tokens freshly connected.
- [ ] Stripe test webhook endpoint pointing at the public URL; test card ready.
- [ ] Time-warp set to the demo speed; seeded workspaces reset to a clean state.
- [ ] OpenAI daily cap well above demo needs; fallback auto-reply text verified in Urdu and English.
- [ ] Backup screen recording of the full flow in case the venue network fails.

1. **0:00–0:30 Hook.** Speed-to-lead statistic. "A lost lead is lost money, so we made losing one impossible."
2. **0:30–1:00 Onboarding.** Type one sentence; the AI proposes the workspace (F9.3); confirm. Optionally switch the UI to Urdu (F7).
3. **1:00–2:30 Core loop.** A judge's phone sends a WhatsApp message in Roman Urdu, or a voice note.
   - The AI stand-in replies in Roman Urdu within seconds (F6), and the transcript appears (F8.1).
   - The lead appears on Lead Radar and moves to its assignee (F5.6), with the routing trace visible (F3.11).
   - The assignee ignores it, the ring turns red, and the lead escalates.
   - A Telegram alert arrives with the AI brief; the new owner taps Acknowledge (I4.5).
   - The handoff card appears, and the customer receives "Hamza has joined" (F6.10).
4. **2:30–3:30 Close the deal.** Book a slot that appears in the real Google Calendar (I3); send a Stripe link from the chat ($ button); the judge pays with a test card; confetti, the dashboard ticker and Revenue Rescued update (F5.8).
5. **3:30–4:15 Proof.** Judge Console: duplicate webhook, forged signature and simultaneous timers all handled (F10.1). Audit chain verified (F4.4).
6. **4:15–5:00 Business.** Revenue at Risk, the market gap (WhatsApp-first, accountability-first, Urdu-native), pricing direction (per workspace plus per rescued lead), and the roadmap (JazzCash and Easypaisa, more languages).

---

## 9. Glossary and metric definitions

Each term has one meaning everywhere: dashboard, lists, exports, alerts and audit history.

| Term | Definition |
|---|---|
| Workspace | One company's isolated environment, with its own users, data, configuration, AI settings and integrations |
| Lead | A record created by intake (web form, incoming message or manual entry) with a source label |
| Assigned time | The moment the system last assigned ownership of the lead to a human, including initial fallback custody if no eligible handler exists. The first-ever assignment time is stored separately and never reset by later transfers. |
| Acknowledged | The **human** assignee clicked Acknowledge (in-app or Telegram), or performed a recorded action on the lead (note, message, call log, stage change, appointment). **AI messages never count.** |
| Acknowledged-but-idle | An acknowledged lead with no recorded human action within the configured idle time. It qualifies for the original idle-based recovery queue; if the P1 re-trigger rule is enabled, it also re-enters routing (F3.10). |
| Time to first response | Time from the lead's first assignment to its first acknowledgement |
| Escalation | An automatic reassignment caused by an expired acknowledgement window, preserving the original PDF definition. Manual reassignments, pond claims, absence/deactivation transfers and idle re-trigger reassignments are counted separately. Retrying routing or retaining the same fallback owner without a transfer is not an escalation. |
| Idle re-trigger reassignment | A P1 automatic reassignment caused by inactivity after acknowledgement (F3.10). Stored with a separate event type and counter; excluded from the original escalation figure and the recovery queue's two-escalation threshold. |
| Recovery queue item | A lead that is unacknowledged beyond its window, has escalated two or more times, or has no recorded action for the configured idle period |
| Pond claim | An Available employee taking a lead from the recovery queue; counts as assignment plus acknowledgement |
| Call log | A manually recorded phone call on a contact or opportunity (direction, outcome, duration, summary); counts as a recorded action |
| Tag | A free-form label an Admin defines and users attach to contacts or opportunities; usable as a filter criterion |
| Deactivated user | A user who can no longer sign in, keeps their history, and receives no leads |
| Available employee | A user whose status is Available and whose open-lead count is below their capacity limit |
| Eligible handler | An active Available employee below capacity who matches the enabled routing rules. Only eligible handlers receive ordinary handling assignments or make successful claims. |
| Fallback custody | Accountability held by the active designated manager, or otherwise the workspace Owner, while no eligible handler has accepted the lead or the routing chain is exhausted. Exactly one named human remains accountable; custody does not imply availability, a handling assignment or acknowledgement. |
| Routing trace | The stored explanation of why a lead was assigned to a given person |
| Rotting opportunity | An opportunity with no recorded action for longer than its stage's rot period |
| AI stand-in | The AI mode that replies to a customer while no human has acknowledged the lead. It never owns or acknowledges a lead. |
| AI-held time | Time between the first AI stand-in message and the human takeover in a conversation |
| Handoff | The moment a human takes over a conversation from the AI stand-in |
| Customer language | The detected language and script of a contact: `ur` (Urdu script), `ur-Latn` (Roman Urdu) or `en` |
| Open pipeline value | Sum of values of opportunities not in a won or lost stage, grouped by stage; shown only to users permitted to see values |
| Projected revenue | Value of open opportunities plus payment requests not yet paid |
| Collected revenue | Sum of payments confirmed by the payment provider's webhook, minus confirmed refunds |
| Revenue at risk | Sum of the values of open opportunities linked to leads currently **unacknowledged** (including those in the AI stand-in), plus the workspace's configurable *default lead value* for each such lead with no opportunity value. Shown only to users permitted to see values. |
| Revenue rescued | Collected revenue in the period from opportunities whose lead had at least one **acknowledgement-timeout escalation** before its first-ever acknowledgement. Later idle re-triggers do not retroactively qualify a lead. |
| Conversation | All messages with one contact on one channel, linked to the contact, its assigned employee and, when applicable, an opportunity. Includes AI messages, labeled as such. |
| Appointment | A calendar event created from the platform and linked to a contact or opportunity |
| Integration event | Any inbound webhook or outbound call to an external provider, including every OpenAI call, recorded in the synchronization history |

---

## 10. Build priority

1. **All P0 requirements** (the baseline portions of F1–F5 and I1–I5, plus Q1–Q14). Verify these independently of their P1/P2 extensions, including ownership when no handler is eligible, ordinary form confirmation, in-app acknowledgement, baseline Telegram alerts and the visible P0 absence policy.
2. Lead Radar (F5.6), escalation policy builder and routing trace (F3.5, F3.11), Telegram Acknowledge (I4.5).
3. AI stand-in with handoff card and AI brief (F6, F9.2).
4. Judge Console and time-warp (F10.1, F10.2).
5. Urdu UI with RTL and customer-language matching (F7).
6. Revenue at Risk and Revenue Rescued (F5.7, F5.8); in-chat $ button and booking after web form (I2.1, I3.8).
7. Voice-note transcription (F8.1–F8.3).
8. Describe-your-business onboarding and AI fields (F9.3, F9.1).
9. Hash-chained audit (F4.4), stage rot (F2.9), pond claim (F3.7 P1), acknowledged-but-idle re-triggering (F3.10) and its separate dashboard counter.
10. CSV import (F2.12) and event replay (I5.9).
11. P2 items: push-to-talk, voice commands, command bar and natural-language rules, suggested replies, deal health score, "Work this list".

P0 also includes the implicit items made explicit in C15: invites, custom roles, user deactivation, tags, CSV export, call and note logging, the public web form and the designated backup.

**Baseline acceptance checks:** demonstrate (a) intake with everyone Offline or at capacity still has one active human accountable owner and a visible awaiting-handler reason; (b) two simultaneous claims produce one winner and one owner; (c) absence, deactivation and chain exhaustion never leave a live lead ownerless; (d) an acknowledgement-timeout reassignment increments the original escalation count, while an idle re-trigger increments only its separate counter; and (e) form capture, in-app acknowledgement, recovery visibility and useful Telegram alerts still work with the corresponding P1 enhancements disabled. The first-to-claim and idle re-trigger checks become required when those P1 features are built; the remaining checks are P0.

---

## 11. Deferred / roadmap (not in this build)

- Voice-call dispatch in the style of Callingly (ring the rep, "press 1 to accept", bridge the customer): requires paid telephony.
- JazzCash and Easypaisa payment adapters.
- AI voice-note replies (text-to-speech in Urdu).
- Additional languages (Punjabi, Sindhi, Pashto).
- Outcome-based billing (per rescued lead) for the platform itself.
- Missed-call text-back (automatically sending a WhatsApp message when a business call goes unanswered): requires telephony integration.
- Manager daily digest of missed and rescued leads over Telegram.

---

## Appendix A: Coverage of the original problem statement

Every section and requirement ID of the original PDF is preserved in this document. IDs are unchanged, so test names and the traceability page (F10.3) can use them directly.

| Original section / ID | Where it lives now | Status |
|---|---|---|
| §1 Background and problem, "What goes wrong today", "What a successful solution achieves" | Section 1 | Kept in full; additions marked *(Added)* |
| §2 Target users (Owner, Admin, Manager, User, Customer; three base levels, Manager as configurable role) | Section 2; F1.7 | Kept; Manager role made explicit (F1.7) |
| §3 Scope (fifteen-module vision; must-solve versus not-part-of lists) | Section 3 | Kept; added items listed in the scope table |
| §4 intro: real stored data; timers observable in seconds | Section 4 intro; F10.2 | Kept; time-warp added |
| F1.1–F1.6 | Section 4, F1 | All kept (F1.2, F1.3, F1.4, F1.6 extended); F1.7–F1.8 added |
| F2.1–F2.8 | Section 4, F2 | All kept (F2.1, F2.2, F2.7, F2.8 extended); F2.9–F2.13 added |
| F3.1–F3.9 | Section 4, F3 | All kept; fallback accountability and first-to-claim ownership clarified (C18); F3.6 has a standalone P0 absence policy plus P1 idle re-triggering; F3.10–F3.12 added |
| F4.1–F4.3 | Section 4, F4 | All kept; F4.4 added |
| F5.1–F5.5 | Section 4, F5 | All kept, including the original escalation metric; idle re-trigger counts are separate; F5.6–F5.9 added |
| §5 intro (real services, sandbox/test modes, three mandatory plus one chosen) | Section 5 intro | Kept; Twilio requirement waived per reported organizer guidance, Meta selected by the team (C1) |
| I1.1–I1.9 | Section 5, I1 | All kept, rewritten for Meta Cloud API; I1.0, I1.10, I1.11 added |
| I2.1–I2.8 | Section 5, I2 | All kept (I2.1, I2.2 extended) |
| I3.1–I3.7 | Section 5, I3 | All kept; I3.8–I3.9 added |
| I4.1–I4.4 | Section 5, I4 | All kept with Telegram as the chosen provider; I4.5 added |
| I5.1–I5.8 | Section 5, I5 | All kept (I5.1, I5.6 extended); I5.9 added |
| Provider constraints table | Section 5, provider constraints | Kept, updated for Meta, Telegram and OpenAI; Twilio, Slack and email rows retained as alternatives |
| §6 Quality Q1–Q14 | Section 6 | All kept (several extended); Q15–Q18 added |
| §7 Glossary and metric definitions (all 14 terms) | Section 9 | All original terms retained; the original acknowledgement-timeout escalation meaning and counter are preserved. "Acknowledged" is explicitly human-only, and assignment timestamps cover initial fallback custody. Idle re-triggering and other team additions have separate definitions; see C18–C19. |
