// Money on the wire (docs/11-api.md §1, F1.4): `{ amountMinor, currency }`, or `{ masked: true }` when the
// caller may not see it. Produced ONLY by the server's core/auth/mask.ts; the client never receives a
// raw value it is supposed to hide. Owner: Lane B (T-102).
import { z } from 'zod';

export const currencySchema = z.string().length(3);

export const visibleMoneySchema = z.object({
  masked: z.literal(false),
  /** Minor units (paisa for PKR). Safe as a JS number below 2^53 (10 §1). */
  amountMinor: z.number().int(),
  currency: currencySchema,
});
export const maskedMoneySchema = z.object({ masked: z.literal(true) });

/** A money value that may be masked. `null` = no value set (distinct from masked). */
export const moneySchema = z.discriminatedUnion('masked', [visibleMoneySchema, maskedMoneySchema]);
export type MoneyDto = z.infer<typeof moneySchema>;

/** A bare figure (dashboard totals) that may be masked. */
export const moneyFigureSchema = z.object({
  value: z.number().int().nullable(),
  masked: z.boolean(),
});
export type MoneyFigureDto = z.infer<typeof moneyFigureSchema>;
