// The Lottie budget (components.md §7: <= 5 files). Sources: tools/lottie/build.mjs → public/lottie/<name>.json.
// Adding a sixth file needs a design decision (docs/design/README.md), not just a new entry here.
export const LOTTIE_META = {
  /** Confirmed success (payment received, saved). One-shot; rests on the drawn check. */
  success: { loop: false, rest: 'last' },
  /** Calm "all clear" sun for empty states (inbox zero, nothing scheduled). Ambient loop. */
  'all-clear': { loop: true, rest: 'first' },
  /** Baton passing between two people: AI → human handoff, onboarding / long loaders. Loop. */
  handoff: { loop: true, rest: 'first' },
  /** Confetti + star: recovery queue empty, payment paid. One-shot; rests on the star badge. */
  celebrate: { loop: false, rest: 'last' },
  /** Live pulse (realtime on, integration connected). Loop. */
  live: { loop: true, rest: 'first' },
} as const satisfies Record<string, { loop: boolean; rest: 'first' | 'last' }>;

export type LottieName = keyof typeof LOTTIE_META;
export const LOTTIE_NAMES = Object.keys(LOTTIE_META) as LottieName[];

/** `tok:<name>` (fill/stroke `nm` in the JSON) → CSS variable the player reads the live colour from. */
export const TOKEN_VAR: Record<string, string> = {
  brand: '--brand',
  'brand-soft': '--brand-soft',
  'brand-faint': '--brand-faint',
  'data-b': '--data-series-b',
  ink: '--text-primary',
  surface: '--surface',
  success: '--success',
  'success-surface': '--success-surface',
};
