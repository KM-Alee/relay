# Design Tokens — Relay (Warm Orange)

> **Status:** Accepted. Palette: **Warm Orange** (variant 02 of the design package). Source: `source/DESIGN_GUIDE.md` §02–§03, plus derived dark mode and Urdu typography.
> **Code home:** `apps/web/app/globals.css` (CSS variables) → Tailwind theme (`@theme` in Tailwind v4) → shadcn/ui components. **Components never use raw hex values. Only tokens.**
> Contrast ratios below were computed (WCAG 2.x). Re-verify with axe in T-012.

## 1. Colour

### Light (default)

```css
:root {
  /* neutrals (guide §03 "shared neutrals") */
  --page-bg:        #F7F8F9;
  --surface:        #FFFFFF;
  --surface-muted:  #F3F5F6;
  --text-primary:   #111318;   /* 18.4:1 on surface */
  --text-secondary: #586273;   /* 6.16:1 on surface */
  --text-muted:     #657184;   /* 4.94:1 on surface, 4.65:1 on page-bg; minimum for body-size text */
  --border:         #E6E9ED;
  --border-strong:  #CDD3DA;   /* inputs, control boundaries (non-text 3:1 with focus ring) */
  --focus-ring:     #242A34;

  /* brand: Warm Orange */
  --brand:          #F36B21;   /* FILL / chart highlight ONLY. Never text on white (3.03:1) */
  --brand-strong:   #C2410C;   /* solid primary buttons with WHITE text (5.18:1) */
  --brand-strong-hover: #A93A0B;
  --brand-soft:     #FFE0C5;   /* active nav capsule, selected rows; text-primary on it (14.8:1) */
  --brand-faint:    #FFF3E9;   /* faint accent surfaces, hero wash */
  --brand-text:     #99420C;   /* small accent text/links on white (6.69:1) */
  --on-brand:       #111318;   /* text/icons on --brand fills (6.14:1) */
  --data-series-b:  #FFD3AD;   /* secondary chart series (pale bars) */

  /* semantic: NEVER themed, never replaced by brand (guide §03) */
  --danger:  #B42318;  --danger-surface:  #FFF0EE;   /* 5.93:1 */
  --warning: #925900;  --warning-surface: #FFF6E6;   /* 5.36:1 */
  --success: #126B46;  --success-surface: #E7F7EF;   /* 5.89:1 */
  --info:    #185ABC;  --info-surface:    #EAF2FF;   /* 5.78:1 */
  --neutral-status: #586273; --neutral-surface: #F3F5F6;  /* pending / disabled */

  /* AI marker (distinct from brand + semantics; always paired with the "AI" text label) */
  --ai:      #5B3FD6;  --ai-surface: #F1EDFF;
}
```

### Dark (derived; Q17 requires light + dark; follows `prefers-color-scheme`, user override in `users.ui_prefs`)

```css
[data-theme="dark"] {
  --page-bg:        #0F1115;
  --surface:        #171A20;
  --surface-muted:  #1E222A;
  --text-primary:   #E8EAED;   /* 15.7:1 on page-bg */
  --text-secondary: #A3ACB9;   /* 7.6:1 on surface */
  --text-muted:     #8B95A3;
  --border:         #2A2F38;
  --border-strong:  #3A404B;
  --focus-ring:     #E8EAED;

  --brand:          #FF8A4C;   /* fill + accent text OK in dark (7.46:1 on surface) */
  --brand-strong:   #FF8A4C;   /* buttons use DARK text in dark mode */
  --brand-strong-hover: #FF9D66;
  --on-brand:       #111318;   /* 7.96:1 */
  --brand-soft:     #3A2416;
  --brand-faint:    #24180F;
  --brand-text:     #FFB088;
  --data-series-b:  #6B3A1C;

  --danger:  #FF8A80;  --danger-surface:  #3A1714;
  --warning: #F5B54A;  --warning-surface: #332408;
  --success: #5DD39E;  --success-surface: #0E2E21;
  --info:    #7FB2FF;  --info-surface:    #12233F;
  --neutral-status: #A3ACB9; --neutral-surface: #1E222A;
  --ai:      #B4A3FF;  --ai-surface: #241C47;
}
```

The button text colour token flips by theme: `--on-brand-strong: #FFFFFF` (light), `#111318` (dark).

### Usage rules (blockers in review)

1. **Brand orange ≠ warning.** Urgency, overdue and escalation states use `--warning`/`--danger` **plus an icon and a text label**. Never use brand orange to mean "attention".
2. Brand orange signals **identity and selection** only: logo, active nav capsule, selected tab/control, primary button, chart highlight, focus accents.
3. Lime/orange-on-white text is forbidden. Accent text uses `--brand-text`.
4. Every status badge = semantic colour + icon + label. Colour is never the only carrier (Q8).
5. One primary (brand-strong) button per view.

## 2. Data visualization palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `--chart-primary` | `#111318` (charcoal line) | `#E8EAED` | Main series (line), as in the reference |
| `--chart-highlight` | `var(--brand)` | `var(--brand)` | Current period / hovered point / single emphasised series |
| `--chart-secondary` | `var(--data-series-b)` | `var(--data-series-b)` | Secondary series (pale bars) |
| `--chart-cat-1..5` | `#F36B21`, `#111318`, `#FFB37A`, `#8A94A6`, `#C9CCD0` | `#FF8A4C`, `#E8EAED`, `#B85C24`, `#7D8796`, `#4A505B` | Categorical (≤ 5, e.g. lead sources); beyond 5 → "Other" |
| `--chart-grid` | `#EEF0F3` | `#242830` | Muted gridlines |
| Countdown states | `--success` → `--warning` → `--danger` | same | Countdown ring (with number + icon, see components) |

Rules come from guide §06: a zero baseline for bars, units on axes, no unlabeled dual axes (separate plots for money vs counts), tooltips on hover **and** focus, an accessible text summary per chart, and no decorative maps.

## 3. Typography

| Token | Value |
|---|---|
| `--font-sans` | `Inter` (next/font, variable, `latin`), fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--font-urdu` | `Noto Nastaliq Urdu` (next/font, weights 400–700), fallback `"Jameel Noori Nastaleeq", serif` |
| Numerals | `font-variant-numeric: tabular-nums` on KPI values, countdowns, tables, money |

| Style (token) | EN desktop | EN mobile | UR (Nastaliq) | Weight | Notes |
|---|---|---|---|---|---|
| `text-hero` | 52/1.1 | 32/1.15 | 40/1.9 | 650 | Overview title only |
| `text-page` | 32/1.2 | 26/1.25 | 28/2.0 | 600 | Record/form page titles |
| `text-panel` | 17/1.35 | 16/1.35 | 17/2.0 | 600 | Card titles (always name the chart's question) |
| `text-kpi` | 36/1.15 | 30/1.15 | 36/1.4 (digits stay Latin/tabular) | 650 | KPI values |
| `text-body` | 15/1.5 | 15/1.5 | 16/2.0 | 400 | |
| `text-meta` | 13/1.4 | 13/1.4 | 14/1.9 | 450 | Labels, chart axes. Never shrink actions |
| `text-button` | 14.5/1.25 | 14.5/1.25 | 15/1.8 | 550 | Sentence case |
| `text-eyebrow` | 12/1.4, `letter-spacing: .14em`, uppercase | same | 13/1.9, **no tracking, no uppercase** | 500 | |

Urdu rules: Nastaliq needs ~1.9–2.1 line-height and must never be clipped. That means no fixed heights on text containers and no `overflow:hidden` on single-line labels. Apply `:lang(ur)` overrides. Numbers inside Urdu text render in Latin digits by default (configurable via `Intl` numbering system later).

## 4. Space, shape, elevation, motion

```css
:root {
  --space-unit: 4px;            /* 8 px rhythm; 4 px for icon alignment */
  --page-pad: 32px;             /* 16px < 600w, 24px < 960w, 32–48px ≥ 1280w */
  --section-gap: 24px;          /* between sections (more than internal gaps) */
  --card-gap: 16px;
  --card-pad: 24px;             /* 20 px compact, 28 px spacious */
  --radius-card: 18px;
  --radius-control: 11px;
  --radius-chip: 999px;
  --shadow-card: 0 8px 32px rgba(19,25,38,.035);
  --shadow-pop: 0 12px 40px rgba(19,25,38,.10);   /* menus, popovers, drawers */
  --nav-height: 72px;
  --target-min: 44px;           /* comfortable hit target */
  --dur-fast: 120ms; --dur-base: 150ms; --dur-slow: 240ms;
  --ease-standard: cubic-bezier(.2,.0,.0,1);
}
[data-theme="dark"] { --shadow-card: 0 1px 0 rgba(255,255,255,.03); --shadow-pop: 0 12px 40px rgba(0,0,0,.5); }
```

Breakpoints (guide §08): `sm 600`, `md 960`, `lg 1280`, `xl 1600` (page max-width 1600).

Z-index scale: `nav 40`, `drawer 50`, `modal 60`, `popover 70`, `toast 80`.

`@media (prefers-reduced-motion: reduce)` sets every duration to 0, disables pulsing, number tickers jump to their final value, and Lottie shows its last frame.

## 5. Tailwind mapping (sketch)

```css
@theme {
  --color-page: var(--page-bg);   --color-surface: var(--surface);   --color-surface-muted: var(--surface-muted);
  --color-fg: var(--text-primary); --color-fg-2: var(--text-secondary); --color-fg-muted: var(--text-muted);
  --color-line: var(--border);    --color-line-strong: var(--border-strong);
  --color-brand: var(--brand);    --color-brand-strong: var(--brand-strong); --color-brand-soft: var(--brand-soft);
  --color-brand-faint: var(--brand-faint); --color-brand-text: var(--brand-text);
  --color-danger: var(--danger);  --color-danger-surface: var(--danger-surface);
  /* … warning, success, info, ai, neutral likewise … */
  --radius-card: 18px; --radius-control: 11px;
  --font-sans: var(--font-inter), system-ui, sans-serif; --font-urdu: var(--font-nastaliq), serif;
}
```
Lint rule: no arbitrary colour values (`bg-[#…]`, `text-[#…]`) and no Tailwind default palette colours (`bg-orange-500` etc.) in `apps/web`. Use tokens only.
