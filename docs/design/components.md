# Component Specifications — Relay

> **Status:** Accepted. Derived from `source/DESIGN_GUIDE.md` §05, §07, §10, §12 and adapted to Relay's lead-accountability features.
> **Code home:** `apps/web/components/ui/*` (shadcn/ui primitives, restyled with tokens) and `apps/web/components/relay/*` (product components). Every component is built and shown on the dev-only **`/[locale]/dev/kitchen-sink`** page in `en`/`ur` × light/dark (T-012). Agents verify visuals there.
> **Stack (ADR-0009):** shadcn/ui on Radix primitives · `lucide-react` icons · Recharts for charts · `@xyflow/react` for the Automations graph (P1) · Framer Motion · `lottie-react` (≤ 5 files).

Every interactive component defines these states: default, hover, focus-visible (2 px `--focus-ring` outline, 2 px offset), active/selected, disabled, loading, error. It is keyboard-operable, and Escape closes overlays.

## 1. App shell

| Component | Spec |
|---|---|
| **TopNav** | Floating white strip: `margin: 18px 32px 0` (8 px on mobile), height `--nav-height` 72, `--radius-card`, 1 px `--border`, `--shadow-card`. Order (start → end): **Relay wordmark** (orange mark + "Relay"; links to Overview) · destinations · search · notifications · availability + avatar menu. Mirrors in RTL. No left sidebar anywhere. |
| **NavItem** | Icon + text label (never icon-only). 44 px target, 8–12 px gaps. Active = `--brand-soft` capsule, `--radius-control`, `--text-primary` label. Renders only destinations the user may access (no fake disabled items). |
| **MoreMenu** | "More ▾" overflow: Appointments, Payments, Team, Integrations, Audit log, Settings, Judge Console (demo). Below `md`, destinations collapse into it. Below `sm`: app title + search + a labelled "Menu" button opening a sheet. |
| **SearchCommand** | Quiet input until focus ("Search leads, contacts…"). `Ctrl/⌘K` opens a command dialog with results grouped by type (Leads, Contacts, Companies, Opportunities, Messages), arrow-key navigation, and permission-filtered results. The P2 NL command bar (F9.4) extends this dialog. Show the shortcut hint only once implemented. |
| **NotificationsBell + Panel** | Count badge (number, not just a dot) of unread items the user can access. The panel lists pending acknowledgements and escalations first, each with countdown/owner and an "Acknowledge" or "Open" action. Live region `polite`. |
| **AvailabilitySwitcher** | Pill in the avatar menu **and** visible next to the avatar: dot + label (Available / Busy / On leave / Offline) with an icon per state. Changing to On leave/Offline shows a confirmation explaining that unacknowledged leads will be reassigned (F3.6). |
| **TimeWarpBadge** | When warp ≠ 1: a persistent "⏩ 60× time-warp" chip in the nav (`--info` surface). Click opens settings (demo). |
| **PageHeader** | Eyebrow (date/time + workspace scope) · title (`text-page`, or `text-hero` on Overview) · one-sentence answer · ≤ 2 AlertChips · optional decorative art at the end side (≥ 960 px only, `alt=""`). |

## 2. Status and accountability (core to Relay)

| Component | Spec |
|---|---|
| **AlertChip** | Rounded 999, height 44, padding-inline 16. Icon or status dot **plus explicit label + count + chevron**, e.g. `⏱ 3 waiting acknowledgement ›`, `⚠ 2 escalated ›`. Click → filtered list. Max 2 strong chips per header. Risk chips use the warning/danger icon and wording. |
| **StatusBadge** | Semantic colour + icon + label, pill. Variants: `success` (✓), `warning` (⚠), `danger` (⛔/!), `info` (i), `neutral`/pending (◷), `disabled`. Lead-state mapping: Awaiting handler → warning + "Awaiting handler"; Assigned · pending → info + "Waiting ack"; Overdue → danger; Critical → danger + bold; Acknowledged → success; Idle → neutral; Closed → neutral. |
| **CountdownRing** | Circular progress around a **numeric remaining time** (`1:42`, tabular). State by fraction remaining: > 50 % success, 20–50 % warning, < 20 % danger, ≤ 0 "Overdue" + danger icon. An icon + severity label sits beside the ring at ≥ md ("Escalates in 1:42"). Pulsing only in the danger state and only without reduced motion. Updates visually every second. The screen-reader label updates at most every 30 s, plus at threshold crossings (guide §10). Driven by server `ack_window_ends_at` + server-time offset. Sizes: 20 (row), 40 (card), 96 (radar). |
| **OwnerChip** | Avatar + name + availability dot. Variant `fallback`: adds a "Fallback custody" warning badge and a tooltip with the reason ("No one available: all at capacity"). There's always exactly one OwnerChip on a lead (never "assigned to team"). |
| **EscalationStep** | "Level 2 of 4 · escalated 14:03 · Slack ✓ delivered" (guide §10 "Escalated"). |
| **RoutingTrace** | Ordered list: skipped rows (muted, reason badge: On leave / 5/5 open / No skill / Offline) → chosen row (✓, brand-soft background). Collapsible on mobile. (F3.11) |
| **AIBadge** | Text "AI" in an `--ai` pill, always as text. Used on AI messages, AI-filled fields ("AI · 14:02"), and the AI stand-in banner. |
| **MaskedValue** | Lock icon + "Hidden" (i18n). Tooltip: "You don't have permission to see values." Renders the server's `{masked:true}` (F1.4). |
| **ProviderStatus** | Row: provider logo/name · StatusBadge (Connected / Needs attention / Not connected) · "Last OK 2 min ago" · last error (truncated, expandable) · Connect / Reconnect button. |
| **FailureNotice** | Inline at the point of action: danger surface, reason in plain words, **Retry** button. Failed items never disappear (guide §10). |

## 3. Data display

| Component | Spec |
|---|---|
| **Card** | `--surface`, 1 px `--border`, `--radius-card`, `--shadow-card`, padding `--card-pad`. Header: icon tile (32 px, `--surface-muted`) + `text-panel` title + optional one-line description + actions (timeframe Select) at the end. |
| **KpiTile** | Icon + label · big number (`text-kpi`, tabular) · delta with arrow **and interpreted colour** (lower response time = success; more escalations = danger; neutral when meaningless) · comparison label ("vs yesterday") · sparkline (same span across tiles, `--chart-primary` line with `--brand` end-point). The whole tile is a link only if it opens the filtered list (F5.3). Shows a skeleton, an empty state ("No leads yet today") and an error state. |
| **ChartCard** | Card + title (the business question) + scope + period + unit + legend + chart + `<details>` text summary/table for screen readers. Tooltip on hover/focus/touch, anchored, never covering the point. Loading, empty (reason + next action) and error states. Charts render in a `dir="ltr"` island (time flows left→right in both locales); labels are localized. |
| **StageBars** | Replaces the decorative funnel. One row per pipeline stage in pipeline order: stage name · count · value (or MaskedValue) · bar (zero baseline). Stage-to-stage conversion shown as "230 of 492 (47 %)". (F5.1 open pipeline value by stage) |
| **TeamAvailabilityCard** | Replaces the world map. Avatar rows: name · availability badge · open leads `3/5` (capacity bar) · on-shift indicator. Grouped by status. (F5.1, F3.2) |
| **DataTable** | Sticky header, sortable columns, row hover, keyboard row focus, cursor pagination. Below `sm` it becomes **summary cards** with an explicit "Details" affordance (guide §08). |
| **LeadRow** | Name + contact · source badge · OwnerChip · StatusBadge · CountdownRing (20) · last activity · quick "Acknowledge" (owner only). |
| **ActivityTimeline** | Vertical list with icon per type, actor (user/system/AI with AIBadge), relative + absolute time on hover/focus, expandable before/after diff for field edits. |
| **EmptyState** | Short reason + scope + one primary next action. Optional Lottie only for "Recovery queue empty 🎉" (budget item). |
| **Skeleton** | Shaped like the content that will land, plus an `aria-busy` text status. |

## 4. Conversations

| Component | Spec |
|---|---|
| **ConversationList** | Tabs: Waiting · Mine · All (permission). Row: avatar, name, last message preview (1 line), time, unread count, CountdownRing when unacked, AIBadge when the AI stand-in is active. |
| **MessageBubble** | Inbound (start side, `--surface-muted`) / outbound (end side, `--brand-faint`). The author label distinguishes human, **AI** (AIBadge, mandatory F2.7/F6.3) and system. Delivery ticks: sent ✓, delivered ✓✓, read ✓✓ (info colour) with text tooltips; failed → FailureNotice + Retry. Audio: player + transcript + one-line summary, or "Transcription failed · Retry". |
| **EventBubble** | Centered system events: "Paid ✓ PKR 25,000" (success), "Hamza joined the chat", "AI stand-in started", "Appointment booked Thu 3 pm". |
| **Composer** | Text area with persistent label. Actions: template picker, **$ payment link** (P1), **book** (calendar), mic (P2). The **owner + countdown + Acknowledge** sit directly above the composer (guide §11). Blocked states with explanation: opted-out (I1.9), 24 h window closed → template only (I1.10). |
| **WindowIndicator** | "Free-text window open · 18 h left" / "Window closed: templates only" with info/warning badge. |
| **HandoffCard** | Shown on takeover (F6.10): customer goal, collected fields (with AIBadge), sentiment badge (icon + label), 3-line summary, suggested first reply (Insert button) in the customer's language. Dismissible, re-openable. |

## 5. Pipeline and forms

| Component | Spec |
|---|---|
| **BoardColumn / OpportunityCard** | Column header: stage name, count, total value (masked if needed). Card: title, contact, OwnerChip (compact), age in stage, amount or MaskedValue, rot indicator (P1: danger border + "Stale 5d" label, not colour alone). Drag with Framer `layout` animation; keyboard move via a "Move to…" menu; list/table alternative view. Required-field blocks open a dialog listing the missing fields with inline inputs (F2.4). |
| **Button** | Variants: `primary` (`--brand-strong` + `--on-brand-strong`), `secondary` (surface + border), `ghost`, `destructive` (danger), `link` (brand-text). Height 40 (44 on touch), `--radius-control`, sentence case, loading spinner + disabled. One primary per view. |
| **FormField** | Persistent label above, optional helper, error text below with icon (`aria-describedby`), required marker in text ("Required"). Inputs: 40–44 px, `--border-strong`, focus ring. Dropdowns use Radix Select/Combobox. Dates show localized formatting. |
| **ConfirmDialog** | For destructive or consequential actions (delete stage with forced move, deactivate user, set On leave). Says what will happen in one sentence. |
| **Drawer / SideSheet** | Record previews from lists (Attio-style). Opens at the end side, width 480 (full on mobile), Escape closes, focus trapped. |
| **Tabs** | In-page secondary navigation (Overview · Activity · Opportunities · Payments · Appointments). Never in the global nav. |
| **Toast** | Bottom-end. Success (with Undo where safe), error (with what to do). Real provider confirmation is required before saying "sent/paid". |

## 6. Automations (escalation policy builder, P1 T-202)

| Component | Spec |
|---|---|
| **RuleSummary** | Default view: readable sentence chain, e.g. "When a WhatsApp lead arrives → assign to an available rep (round-robin, max 5 open) → wait 2 min for acknowledgement → escalate to next rep → then backup → then manager. Repeat once." Each segment is an editable chip that opens the property inspector. This **is** the P0 "basic settings form" in friendlier form. |
| **FlowCanvas** (advanced) | `@xyflow/react`. Node types: Source trigger, Availability check, Round-robin assign, Ack wait (timeout), Ack/Timed-out branch, Reassign, Backup, Manager, Notify (Slack). Category icons, verb labels, labelled branches. Static edges; never animate edges to suggest success. A linear rule list + full keyboard editing is the accessible alternative. |
| **TestPanel** | "Test flow" runs a simulated lead through `domain/leads/route` (pure functions) using the current team state and shows the event timeline + routing trace. "Publish" is a separate, permission-gated (`routing.manage`), audited action. |

## 7. Motion budget (Q17 + guide §10)

Allowed: nav fade ≤ 150 ms; board card `layout` animation; KPI number tickers; Lead Radar escalation move (lead travels to the new owner's avatar); countdown danger pulse; ≤ 5 Lottie files total (payment received, integration connected, recovery queue empty, AI onboarding loader, one spare). Optional sound cues (new lead, escalation, payment) are off by default and mutable. Nothing animates to imply an unconfirmed success. Everything respects `prefers-reduced-motion`.
