# Design System — Relay

> **Status: ACCEPTED.** Palette: **Warm Orange**. Source package: "ClientIQ — four dashboard variants + design guide" (provided by the team, 2026-10-18). "ClientIQ" was the concept name; **the product is Relay**.
> Read before **any** UI work. Order: this file → `tokens.md` → `components.md` → `screens.md`. `../07-frontend-i18n.md` covers the behaviour side (i18n, RTL, realtime, a11y).

## Files

| File | Contents |
|---|---|
| `tokens.md` | Colour (light + derived dark), chart palette, typography (Inter + Noto Nastaliq Urdu), spacing, radii, shadows, motion, Tailwind mapping, with computed contrast ratios |
| `components.md` | Every component's anatomy, states and Relay-specific behaviour (CountdownRing, OwnerChip, AlertChip, MessageBubble, RuleSummary, …) |
| `screens.md` | Navigation/IA, the Overview layout mapped to F5.1 figures, and the page families (Leads/Inbox, Pipeline, Recovery, Automations, …) |
| `source/DESIGN_GUIDE.md` | The original guide, kept verbatim for reference |
| `assets/reference-orange.png` | The chosen reference mockup (visual benchmark only) |

## The look in one paragraph

Bright, spacious, **top-navigation-only** dashboard on a near-white page (`#F7F8F9`). A floating white rounded nav strip carries an orange active capsule. Oversized confident type (Inter) sits over generous negative space. White cards have 18 px radii, hairline borders and whisper shadows. There is **one** saturated accent, Warm Orange `#F36B21`, used for identity, selection and chart highlights only. Charcoal text, a charcoal primary chart line with pale-orange bars, and a restrained decorative orange-glass illustration complete it. Calm, legible, action-first: *What matters? What changed? What should I do?*

## Decisions taken while integrating the guide

| # | Topic | Guide says | Relay decision | Why |
|---|---|---|---|---|
| DS-1 | Palette | Pick one of four | **Warm Orange** | Team choice |
| DS-2 | Primary button contrast | Darken the brand if needed | `--brand-strong #C2410C` + white text (5.18:1). `#F36B21` is fill/chart only (3.03:1 with white) | WCAG AA |
| DS-3 | Orange vs warning | Never recolour semantic statuses | Brand orange never means "attention". Urgency = `--warning`/`--danger` + icon + label | Orange brand and amber warning are close in hue |
| DS-4 | KPI count | Three by default | 3 KPI tiles **plus** the secondary cards, so **all 8 F5.1 figures show by default** (all hide-able, F5.5) | P0 requirement wins |
| DS-5 | World map | Usually unnecessary | Replaced by **Team availability** card | F5.1 needs availability; SMBs are single-city |
| DS-6 | Semicircle / funnel | Only if meaningful; show denominators | **StageBars** (counts + values + "x of y") for open pipeline by stage | Honest, matches configurable pipelines |
| DS-7 | Revenue chart | Collected revenue only; separate scales | **Payments collected this month** (line) + count (bars) with explicit axes, or two plots | I2.6, F5.1 |
| DS-8 | Building illustration | Optional; don't hard-code | Lightweight decorative **SVG orange glass panes**, `aria-hidden`, hidden < 960 px | Fast, brand-consistent, no stock art |
| DS-9 | Nav destinations | Overview · Leads · Inbox · Pipeline · Automations · More | Adds **Recovery** as top-level. Lead Radar = Overview tab | Recovery is the core promise |
| DS-10 | Dark mode | Not covered | Derived dark tokens in `tokens.md` | Q17 requires light + dark |
| DS-11 | Urdu | Locale formatting only | Nastaliq font, larger line-heights, no tracking/uppercase, RTL mirroring, charts in LTR islands | F7.2, F7.3 |
| DS-12 | Automations | Guided editor + optional React Flow graph | RuleSummary is the P0 settings form. FlowCanvas + TestPanel are P1 (T-202) | Ship P0 fast; the graph is a differentiator |
| DS-13 | Component base | Figma component library | **shadcn/ui (Radix) + lucide + Recharts + @xyflow/react**, restyled by tokens; a dev `kitchen-sink` page replaces Storybook | Speed + accessibility (ADR-0009) |
| DS-14 | AI marking | Don't imply unsupported AI | AI content always carries a text "AI" badge in a distinct violet (`--ai`) | F2.7, F6.3 honesty |

## Guide principles every screen must pass (from guide §02 and §12 "ready to build")

- Understand workload + attention items in ≤ 5 seconds. Actionable chips link to filtered records.
- One job per visual, and every figure maps to a Section 9 definition and real records.
- Accountability is always visible: **one owner, a clock, ack state, an escalation reason**.
- Progressive disclosure: details go in drawers/tabs, not metadata walls.
- No image-only labels, false payment states or fake success messages. Failures stay visible with Retry.
- Small screens and 200–400 % zoom keep all critical actions. Keyboard, focus, contrast, labels and reduced motion are tested.
- The live lead demo works without any animation.
