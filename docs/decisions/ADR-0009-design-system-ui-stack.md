# ADR-0009: Design system: Warm Orange tokens on shadcn/ui

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** Q7, Q8, Q16, Q17, F5.1, F5.6, F7.2, F7.3

## Context
The team provided a design package (four colour variants + guide) and chose the **Warm Orange** variant. The build must be fast, accessible (WCAG 2.2 AA target), RTL-capable and themeable (light/dark).

## Decision
- Tokens exactly as in `docs/design/tokens.md`. Brand `#F36B21` is fill/highlight only. Solid buttons use `#C2410C` with white text. Semantic statuses are fixed and never brand-coloured.
- Component base: **shadcn/ui** (copied-in components on Radix primitives) restyled with tokens; **lucide-react** icons; **Recharts** for charts; **@xyflow/react** for the Automations graph (P1); Framer Motion; lottie-react (≤ 5 files).
- Fonts via `next/font`: **Inter** (Latin) and **Noto Nastaliq Urdu** (`:lang(ur)`).
- A dev-only `/[locale]/dev/kitchen-sink` page renders every component in en/ur × light/dark instead of Storybook.
- Lint: no raw hex or Tailwind default palette colours in `apps/web`, and no physical `left/right` utilities.

## Consequences
- Accessible primitives (focus, keyboard, ARIA) come free from Radix, so agents style rather than build behaviour.
- Swapping palettes later is a one-file change (`globals.css`).
- Recharts has limited RTL support, so charts render in LTR islands with localized labels (documented in `docs/design/screens.md`).

## Alternatives considered
- MUI / Mantine: heavier theming to match the guide, and they fight Tailwind.
- Hand-rolled components: too slow for the hackathon.
- visx / D3: more control than needed; slower to build.
