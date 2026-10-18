// THE value-masking serializer (docs/06-security.md §2 "Field masking", F1.4). T-102. Owner: Lane B.
// Every output path that can carry an opportunity value goes through here: list/detail serializers, CSV
// export rows, dashboard figures, AI input builders + AI outputs, Slack alerts (per recipient), handoff
// cards, search results, audit before/after. Never hand-roll "if canSeeValue". Masking happens on the
// server: the client never receives a raw value it should not see.
import type { MoneyDto, MoneyFigureDto } from '@relay/contracts/money';
import type { Actor } from './actor';
import { can } from './permissions';

type Minor = number | bigint | null;

export const VALUE_PERMISSION = 'crm.opportunity.value.view' as const;

export function canSeeValue(actor: Actor): boolean {
  return can(actor, VALUE_PERMISSION);
}

const toNumber = (v: Minor): number | null => (v === null ? null : typeof v === 'bigint' ? Number(v) : v);

/** Opportunity-like row → same shape with `valueMinor` nulled when hidden, plus `valueMasked`. */
export function maskOpportunity<T extends { valueMinor: Minor }>(
  actor: Actor,
  o: T,
): Omit<T, 'valueMinor'> & { valueMinor: T['valueMinor'] | null; valueMasked: boolean } {
  if (canSeeValue(actor)) return { ...o, valueMasked: false };
  return { ...o, valueMinor: null, valueMasked: true };
}

/** Dashboard/aggregate figure (pipeline value, revenue at risk/rescued, collected revenue). */
export function maskMoneyFigure(actor: Actor, minor: Minor): MoneyFigureDto {
  if (!canSeeValue(actor)) return { value: null, masked: true };
  return { value: toNumber(minor), masked: false };
}

/** Wire money `{ masked:false, amountMinor, currency }` | `{ masked:true }`; null stays null (no value). */
export function maskMoney(actor: Actor, minor: Minor, currency: string): MoneyDto | null {
  if (!canSeeValue(actor)) return { masked: true };
  const n = toNumber(minor);
  return n === null ? null : { masked: false, amountMinor: n, currency };
}

/** Value-bearing keys in audit diffs, CSV rows, AI context objects. */
export const PROTECTED_VALUE_KEYS: ReadonlySet<string> = new Set([
  'valueMinor',
  'value_minor',
  'amountMinor',
  'amount_minor',
]);

/** Deep-copy `obj` replacing protected value keys with the string '[masked]' when hidden. */
export function maskValueFields<T>(actor: Actor, obj: T): T {
  if (canSeeValue(actor)) return obj;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = PROTECTED_VALUE_KEYS.has(k) ? '[masked]' : walk(x);
      return out;
    }
    return v;
  };
  return walk(obj) as T;
}
