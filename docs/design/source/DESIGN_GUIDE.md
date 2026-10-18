# ClientIQ — Product Interface & Design System Guide

**Version:** 1.0 · **Reference:** Selected top-navigation CRM dashboard, four color variants  
**Audience:** Hackathon design, front-end and product teams  
**Scope:** Visual design, dashboard information architecture, charts, components, interaction patterns, accessibility, responsive behavior, and page-extension rules

> **Design thesis:** Give a small service business a calm, legible control surface that answers *What matters? What changed? What should I do?* Only reveal deeper records and automations when someone asks for them.

## 01 · The selected visual direction

The approved design is a **bright, spacious, top-navigation-only management dashboard**. Its personality comes from confident oversized type, generous neutral space, one saturated accent, a restrained architectural illustration, and high-quality data visuals—not a sidebar, dense widget grid, or decorative animation.

### Anatomy of the reference image

1. **Floating top navigation:** single white rounded navigation strip across the top. Left brand; central product destinations; search, alert, settings and user identity at right. The active destination uses a tinted, rounded capsule.
2. **Editorial hero (upper left):** small eyebrow/greeting, oversized page title, one clear explanatory sentence and two clickable attention/opportunity chips.
3. **Visual hero (upper right):** softly faded architectural imagery with accent-tinted vertical elements and one small informational overlay. It communicates brand character; it must not obscure the text or replace operational information.
4. **Three compact KPIs:** large numbers, metric names, directional change, comparison period, and tiny trend sparkline; each card has one clear purpose.
5. **Large primary chart:** a single prominent trend card in the lower-left with a visible timeframe selector, large contextual amount, axes, restrained grid and an inspectable hover/focus tooltip.
6. **Secondary analysis (right):** one small regional distribution view, a compact lead-mix semicircle chart, and a horizontal conversion funnel. They visually support the hero chart instead of competing with it.
7. **Overall rhythm:** high negative space, 12–20 px radius on panels, subtle borders and shadows, black/charcoal text, muted gray labels and a single accent family.

**Reference canvas:** 1448 × 1086 px (all four included PNGs). It is a visual benchmark, **not** a requirement to hard-code fixed positions or a fixed viewport height. At normal desktop widths use responsive grid constraints and allow vertical scrolling.

### What stays constant across themes

- Layout, wording hierarchy, component shapes, chart scales, alignment and spacing.
- Semantic meanings for statuses: success, warning, danger, pending and disabled.
- Keyboard order, text labels, focus behavior and screen-reader descriptions.
- Legibility: the color variant changes the accent, never the intelligibility of the information.

### What changes between variants

Brand mark, active top-nav treatment, accent UI, illustration tint, data-series palette, chart highlight, selected controls and supporting surfaces. **Never recolor every semantic status orange/blue/green**, because urgency and success must remain distinguishable.

## 02 · Design foundations

### Experience principles

| Principle | Required behavior | Avoid |
|---|---|---|
| First glance | A user understands current workload and attention items in ≤5 seconds | Eleven equally important cards |
| Action first | Place two actionable lead alerts in view and link to filtered records | Metrics that cannot be opened |
| Progressive disclosure | Details live in the lead record, side sheet, tab or menu | Huge metadata walls |
| Familiarity | Standard navigation, search, filters, form controls and confirmation patterns | Experimental navigation gestures |
| One job per visual | Each chart answers a named business question | Charts chosen for decoration |
| Accountability | Show one current owner, clock, acknowledgement state and reason for escalation | Ambiguous “assigned to team” labels |
| Appropriate density | Three meaningful KPI cards by default; extras user-configurable | Compulsory six-card rows |
| Trustworthy data | Figures come from actual stored records and provider confirmations | Beautiful but inconsistent numbers |

### Grid and spacing

- Use an **8 px baseline rhythm**, allowing 4 px for icon alignment and small controls.
- Large screens: page padding 32–48 px, inter-section gap 20–24 px, card padding 20–28 px.
- App header: about 68–76 px tall with a soft border/shadow; top-level nav uses 40–44 px targets.
- Desktop content layout: the main trend chart gets **approximately half** the lower-row width, and two compact right-side cards take the remainder. Use min/max widths, not pixel-locked coordinates.
- Card borders: 1 px #E6E9ED-style neutral; shadow very light, e.g. `0 8px 32px rgba(19,25,38,.035)`.
- Card radii: 16–20 px for panels, 10–12 px for controls, fully rounded for chips.
- Section groups have noticeably **more external than internal spacing**. White space groups related items more elegantly than heavy dividing lines.

### Typography

Recommended web font: **Inter** or a high-quality native system sans-serif. The selected mockup has a modern geometric/neo-grotesque appearance; typography should feel neutral and precise, not ornamental.

| Usage | Desktop target | Weight | Notes |
|---|---:|---:|---|
| Hero page title | 48–56 px / 1.05–1.15 | 600–700 | Reserve for dashboard top only |
| Page title (record/form) | 28–36 px / 1.2 | 600 | Lower than hero |
| Panel title | 16–18 px / 1.35 | 600 | Label chart purpose explicitly |
| KPI value | 32–38 px / 1.15 | 600–700 | Tabular numerals |
| Base body text | 15–16 px / 1.5 | 400 | Comfortable for longer use |
| Metadata / chart label | 12–14 px / 1.4 | 400–500 | Do not shrink critical actions |
| Button text | 14–15 px / 1.25 | 500–600 | Sentence case |

Use a maximum of three distinct visual text emphases in one card (label, number, contextual change). Muted text still needs accessible contrast.

## 03 · Color variants

These are **proposed implementation tokens approximating the concept art**, not measured claims about exact PNG pixels. Designers should sample/reconcile during Figma implementation and run contrast checks.

| Token | Original lime | Warm orange | Bright blue | Monochrome |
|---|---|---|---|---|
| Brand accent | `#82D900` | `#F36B21` | `#1677E8` | `#151515` |
| Active nav bg | `#D8F6AE` | `#FFE0C5` | `#DAECFF` | `#181818` |
| Faint accent surface | `#F1FBE2` | `#FFF3E9` | `#ECF5FF` | `#F0F0F0` |
| Deep accent for small text | `#356300` | `#99420C` | `#1654A3` | `#111111` |
| Chart series B | `#CFF2A5` | `#FFD3AD` | `#B7DDFF` | `#C9CCD0` |
| Selected illustration tint | Leaf/lime glass | Amber/orange glass | Cool blue glass | Grayscale glass |

**Shared neutrals**

```css
:root {
  --page-bg: #F7F8F9;
  --surface: #FFFFFF;
  --surface-muted: #F3F5F6;
  --text-primary: #111318;
  --text-secondary: #586273;
  --text-muted: #657184;
  --border: #E6E9ED;
  --focus-ring: #242A34;
  --radius-card: 18px;
  --radius-control: 11px;
  --space-unit: 4px;
}
/* Pick exactly one of the four accent palettes above for --brand,
   --brand-soft, --brand-text, and --data-series-b. */
```

**Semantic tokens (do not change with theme):** danger `#B42318` with light surface `#FFF0EE`; warning `#925900` with light surface `#FFF6E6`; success `#126B46` with light surface `#E7F7EF`; informational `#185ABC` with light surface `#EAF2FF`. Semantic tokens require independent WCAG contrast validation for their actual usage.

**Contrast rule:** Bright lime on white is a highlight **fill**, not text color. Use dark text on lime fills. For blue/orange primary solid buttons, choose a darkened brand shade if necessary to provide sufficient white-label contrast. Monochrome still uses text/icons/shape to distinguish severity rather than hiding it.

**My design recommendation:** Lime is the most distinctive; blue is the safest conventional enterprise alternative; orange feels energetic and warm; monochrome is the least distracting but requires careful emphasis for urgency. Commit to **one** palette at a time; do not mix them as functional color categories.

## 04 · Navigation and information architecture

### Top navigation (no persistent left sidebar)

The image displays **Overview · Leads · Pipeline · Forecast · Insights**. For the actual hackathon brief, adapt the destinations to user jobs:

**Suggested common destinations:** `Overview | Leads | Inbox | Pipeline | Automations | More ▾`

The **More** menu contains Appointments, Reports, Team, Integrations and Settings as permitted. Search, notifications, availability/user identity and help sit to the right. Managers and admins can access more functions; staff see only what they are allowed to use. Do not render fake disabled menus for pages without access.

- Brand click → home overview.
- Nav is horizontal with clear current-tab state and text, not icon-only.
- Global search searches permitted people, companies, opportunities and messages; results are grouped by record type, with keyboard navigation.
- Notifications open a focused panel with pending acknowledgements and escalations; count only items the user can access.
- Profile menu includes workspace switcher where relevant, availability status and sign out.
- The navigation may scroll or collapse under a labelled More control on smaller screens; keep key tasks within one tap.
- Secondary tabs belong **inside pages** (e.g. Overview, Activity, Deals, Payments), not in the global nav.

### Homepage content order

1. **Header** with specific date/time and workspace scope.
2. **One-sentence operational answer**, e.g. “12 new leads today · 2 need attention.” Avoid “AI” in the title unless an actual AI feature is present.
3. **Two important clickable chips**: waiting acknowledgement and at-risk escalations. Do not overuse badges.
4. **Three KPIs**: new leads, average time to first acknowledgement, recovery count. Switch metric selection by role.
5. **One primary chart**: pipeline movement or collected-payment trend, selected for that role.
6. **Two supporting visualizations**, only where meaningful for the workspace.
7. **Direct action route** to open the filtered leads needing attention. If live warnings are present, do not bury them beneath the chart.

The original image's “Churn risk,” “Active clients by region” and “$12.5M revenue” are **illustrative concepts**. They should not be presented as measured capabilities if the application does not calculate them.

## 05 · UI component specifications

### Top navigation

Height approx. 72 px desktop; item hit area min. 44 px recommended; gap 8–12 px. Active state is a filled rounded rectangle with icon plus label. The search box stays visually quiet until focus. Show keyboard shortcut (`Ctrl+K` or `⌘K`) only where implemented. On a 375 px phone, use app title, search and an accessible menu with short destinations.

### Hero header

Left: optional eyebrow, title, one sentence and 1–2 important action chips. Right: architectural image treated as **non-essential decoration**, soft gradient fade into the page. Use `alt=""` for purely decorative art. Never put core metrics solely on the illustration. On tablet/mobile omit or reduce the visual before reducing text size.

### Action chips

At most two strong attention chips in the hero. Shape: rounded 999 px; horizontal padding ~16 px; height ~44 px; content: icon or status dot **plus an explicit short label**, count and optional arrow. Click → a filtered list. Notifications with risk meaning should use warning icon and distinct wording, not only color.

### KPI cards

Three across desktop. One icon, one label, a large number, small comparison label, small sparkline. Whole card can act as a link **only if** it opens the corresponding filtered list. Difference signs must be interpreted, e.g. lower response time is a good outcome while rising escalations is bad. Never turn every positive numeric change the current brand color without meaning.

### Data cards

Header area: descriptive title, optional one-sentence description, timeframe filter top-right. Chart takes the largest area. Footer can show legend and scope. Disable decorative overlay controls that obscure axis labels; tooltips appear on hover **and keyboard focus**. Empty chart offers a clear explanation and next action.

### Lists and detail views

For the lead or customer drill-down, prioritize: name/contact, source, assigned owner, acknowledgement state, remaining SLA time and reply action. Full profile fields, audit events, payments and appointments live in tabs/drawers, not all in the first viewport. Use an explicit badge for stale provider connection or failed message; failed operations cannot silently disappear.

### Buttons and forms

One primary action per view. Use native-feeling inputs with persistent labels, helper text only where needed, visible validation and accessible errors. Avoid unlabeled icon-only primary controls. Destructive actions need confirmation or safe undo where possible.

## 06 · Data visualization guidelines

**The central rule:** If a chart doesn't help the user notice, compare, prioritize or act, remove it.

| Visualization shown in image | Business question | Correct usage | Remove or replace when… |
|---|---|---|---|
| Revenue line + pale bars | How is financial performance changing over time? | Show provider-confirmed **collected revenue** trend; label units/time window; separate client counts from dollar scale or use explicitly marked axes | No reliable payments; use pipeline count trend instead |
| Small sparklines | Improving or declining? | Same time span for comparable cards; concise current value and period | No history or trend is volatile/non-interpretable |
| Regional map | Where are clients or leads located? | Use only if records have usable, consented geographical granularity and multiple meaningful areas | Typical single-city, 5–30-employee business: replace with team availability or lead sources |
| Semicircle distribution | How are leads segmented? | Show shares that total 100%; define qualification logic; display exact category values and accessible text summary | Segments aren't available or the gauge duplicates pipeline information |
| Conversion funnel | At which stage do opportunities drop out? | Counts and stage-to-stage conversion clearly defined; include zero stage and sample size; stage order matches configurable pipeline | Business has a non-linear pipeline or counts are misleading; use a stage table or step bars |

### Truthful numbers

- **New leads today:** count lead intake records for the chosen workspace and calendar date; display local timezone.
- **Average first response:** the brief defines this as time from first assignment to **first acknowledgement**; a note or stage change may qualify. Avoid claiming it measures the customer's first received reply.
- **Recovery queue:** records overdue for acknowledgement, escalated at least twice, or idle beyond configured threshold.
- **Open pipeline value:** sum only opportunity values in non-won and non-lost stages, hidden for users without value permission.
- **Collected revenue:** provider-confirmed payments minus confirmed refunds, **not** unpaid opportunity values or a fabricated estimate.
- **Escalation count:** timer-triggered reassignment, not manual reassignment.
- **Employee availability:** only Available employees below their open-lead limit are eligible for new assignment.

### Chart mechanics

- Line charts: label units; use no unnecessary smoothing that invents turning points; avoid unlabeled dual axes.
- Bar charts: use a zero baseline; use length for comparable quantities; muted grid; no decorative 3D.
- Funnels: show counts **and** denominators, not percentages alone; do not use visually deceptive area shapes for precise comparisons.
- Maps: use a table summary for screen readers and a text alternative for data markers; never treat a decorative world map as useful by default.
- Every chart has: visible title, scope, period, unit, legend (if multi-series), accessible textual summary, drill-down where permitted, and loading/error/empty states.
- Color must not be the sole channel. Use labels, distinct line types, icons, pattern alternatives, and text values.
- Display tooltips on mouse hover, touch selection and keyboard focus. Use a visible point highlight and an anchored tooltip that doesn't cover neighboring values.

## 07 · Workflow editor: retain the same design language

The dashboard stays simple. **Automations is a separate product surface**, not a layer of nodes on top of Overview.

- Default view: a short readable rule summary and **guided setup**, e.g. “When a new lead arrives → assign to an available employee → wait 5 minutes → escalate.”
- Advanced view: a React Flow/n8n-style editable graph with a compact node palette and contextual property inspector.
- Supported node types initially: source trigger, availability check, round-robin assignment, acknowledgement wait, acknowledged/not-acknowledged condition, reassignment, backup/manager escalation and external notification.
- Nodes use consistent category icons and concise action verbs, with complete branch labels (Yes / No, Acknowledged / Timed out).
- `Test flow` uses simulated input; a visible event timeline shows actual rules that fired. `Publish` is separate and permission-restricted.
- Show real errors, retries and connection status. Avoid animated connectors that suggest execution success when none was confirmed.
- Provide a linear textual list of rules and full keyboard navigation as an alternative to dragging nodes.

## 08 · Responsive behavior

| Width | Structure | Priority |
|---|---|---|
| ≥ 1280 px | Desktop top nav, two-column hero, three KPI cards, large chart + compact right cards | Match chosen reference |
| 960–1279 px | Compact navigation, smaller/optional hero art, lower charts reflow to two columns | Keep text, data and actions |
| 600–959 px | Overflow top-nav into More; 2 KPI cards per row, charts stack, visual hero minimized | First action, then metrics |
| < 600 px | One-column layout; labelled menu, search action, hero title 28–34 px, cards stack; full-width charts and actions | No horizontal page scroll |

On mobile, keep the attention queue near the top. Charts should resize without clipping labels. Dense tables become summary cards with an explicit details affordance. Do not convert all nav destinations into unlabeled icons. Keep the workflow diagram optional and offer a rule-list alternative.

## 09 · Accessibility & inclusive design acceptance

Target **WCAG 2.2 AA** for the interactive product, not just the screenshots.

- Text contrast generally ≥ 4.5:1 for normal-sized text and ≥ 3:1 for qualifying large text; non-text control boundaries/focus indicators require adequate contrast.
- Visible focus ring; full Tab/Shift+Tab navigation; Escape dismisses overlays; inputs have labels; error messages are described in text.
- Use 44 × 44 px as a recommended comfortable tap/click target wherever layout permits; ensure at least the applicable WCAG target-size requirements.
- Respect `prefers-reduced-motion`; chart animations must not be required to understand status or data.
- Screen reader: heading order, landmark navigation, accessible chart summaries/tables, live-region updates for new leads and escalations without excessive announcements.
- Never communicate urgency, completion or financial gain solely via green/orange/blue/red colors.
- High-zoom support at 200%–400% without lost essential content; no hover-only critical interactions.
- Dates, currencies, local time zones, numeric formatting and language can be configured for the company; use appropriate locale separators.

## 10 · Motion, states and feedback

| Interaction/state | Recommended behavior |
|---|---|
| Nav transition | Immediate content change or short fade ≤ 150 ms; visible selected tab |
| Loading | Skeleton only where data will land, with text status for assistive technology |
| Empty | Clear reason, scope and one useful next action; avoid decorative emptiness |
| New lead | Add to relevant list in real time, low-distraction badge/notification, avoid page jumping |
| Deadline ticking | Textual remaining time, update without distracting minute-by-minute screen-reader chatter |
| Approaching escalation | Icon + severity label + exact remaining time; not just a pulsing red color |
| Escalated | Show new accountable owner, time, step level and channel notification status |
| Webhook/payment failure | Preserve item with failure reason and retry action; no silent loss |
| Success | Brief confirmation with undo where safe; real provider confirmation required for delivery/payment |

## 11 · Page families beyond the overview

**Leads / Inbox:** split view. Left list (unread / waiting / mine), center conversation or lead detail, optional right inspector. Always show accountable owner and acknowledgement deadline near primary reply button.

**Pipeline:** draggable stage board with consistent opportunity cards. Each shows title, contact, owner, stage, age and amount only if permitted. Provide keyboard stage moves and table/list alternative. Required-field validation interrupts unsafe moves with precise instructions.

**Recovery:** prioritized list, not a chart wall. Show reason, SLA time, number of escalations, current owner and one recommended intervention. Filter and save views; drill down into audit timeline.

**Customer profile:** headline and relevant next action first; tabs for Conversations, Opportunities, Payments, Appointments and Activity. Surface failure states at the point of action.

**Automations:** flow canvas and guided editor as described above. Include test panel and event replay.

**Integrations:** concise provider rows (Connected / Needs attention / Not connected), last successful sync, recent error and Connect / Reconnect. Hide credentials in the browser and permission-check changes server-side.

**Team / roles:** availability and open-load counts, permissions matrix for administrators, minimal personal profile view for staff.

**Appointments / Payments:** dedicated screens when needed, but actions also appear in the relevant customer record. Only provider-confirmed outcomes count as completed.

## 12 · Designer-to-developer handoff

### Suggested CSS layout skeleton

```css
.app-shell { background: var(--page-bg); min-height: 100vh; }
.topnav { margin: 18px 32px 0; min-height: 72px; border-radius: 18px; }
.page { max-width: 1600px; margin: 0 auto; padding: 32px; }
.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .92fr); gap: 24px; }
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; }
.analytics { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: 16px; }
.analytics-secondary { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 16px; }
@media (max-width: 960px) { .hero, .analytics { grid-template-columns: 1fr; } }
@media (max-width: 600px) {
  .topnav { margin: 8px; }
  .page { padding: 16px; }
  .kpis, .analytics-secondary { grid-template-columns: 1fr; }
}
```

This is **a starting sketch**, not a complete app implementation. In particular, the design image's bottom-right chart matrix may require CSS grid areas and breakpoint-specific reordering; engineers must tune the structure with real content, not pixel-match an image at every width.

### Figma component library

Design components with clear variants/states: top-nav item, search, menu, avatar/workspace switcher, alert chip, status badge, KPI tile, card header, chart shell, selector, form field, button, toast, modal, drawer, lead row, contact card, tab, empty state, skeleton, provider connection status, workflow node and workflow edge. For each, provide: default, hover, focus-visible, active, disabled, loading/error (if applicable), keyboard behavior and responsive rules.

### Definition of “ready to build”

- [ ] The team chooses **one** of the four color palettes and finalizes measured accessible tokens.
- [ ] Overview, Leads, Inbox, Pipeline, Recovery and Automations each have clear primary actions.
- [ ] Every figure has a business definition and maps to real backend data.
- [ ] Every KPI/drill-down respects role and field-level permissions.
- [ ] No image-only labels, false payment states or fake success messages.
- [ ] Small screens and high zoom retain all critical actions.
- [ ] Keyboard, focus, contrast, form labels, error messages and reduced-motion behavior are tested.
- [ ] The end-to-end live lead demo works independently of UI animation.

## 13 · Implementation priorities for the hackathon

**First:** build the responsive app shell, typography, tokens, actions, attention chips and one honest KPI strip.  
**Second:** build the actual lead list/detail and recovery action—without this, the home page is only decoration.  
**Third:** connect real lead events and acknowledgement/escalation updates.  
**Fourth:** add one useful line/bar visualization and a correct pipeline stage overview.  
**Fifth:** build the guided workflow editor and optional graph simulation.  
**Last:** enrich illustration and motion *without introducing UI clutter or false signals*.

### What not to copy literally from the generated images

1. The rendered data values and dates are **illustrative placeholders**, not validated business records.
2. The building image is visually appealing but should not be hard-coded into a clinic or unrelated business workspace. Replace it with optional industry-specific art or omit it.
3. A “world map” is usually unnecessary for a 5–30-person service business. Prefer actionable operational data if the geography is not meaningful.
4. A glowing “AI” title must not imply unsupported AI functionality.
5. The mockup trend chart may visually combine unlike measures; in implementation use explicit scales or separate plots.
6. Some theme renderings recolor status indicators to brand hues; production semantic statuses must remain meaningful and accessible.

## 14 · Design references and standards

- [Microsoft Fluent 2 — Layout](https://fluent2.microsoft.design/layout): proximity, negative space, alignment, reflow and grouping.
- [Microsoft Fluent 2 — Typography](https://fluent2.microsoft.design/typography): hierarchy, scaling and sentence-case labeling.
- [Microsoft Azure portal dashboards](https://learn.microsoft.com/en-us/azure/azure-portal/azure-portal-dashboards): focused task-based dashboards and configurable tile arrangements.
- [HubSpot — Customize records](https://knowledge.hubspot.com/object-settings/customize-records): record information architecture and configuration.
- [Attio — Create and view records](https://attio.com/help/reference/managing-your-data/records/create-and-view-records): side previews and quick record context.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): contrast, target size, keyboard and accessibility acceptance.

---

**Deliverable note:** This is a product design guide for the four image directions, not an assertion that any generated picture has passed real-world usability or WCAG evaluation. Treat it as a specification to implement and verify with real users.
