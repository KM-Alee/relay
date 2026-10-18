// Price table in USD per 1M tokens (== micro-USD per token). Verified 2026-10-18 against
// https://developers.openai.com/api/docs/pricing (Standard tier). Unknown model => conservative default.
export const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-5-nano': { in: 0.05, out: 0.4 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-5-mini': { in: 0.25, out: 2 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-5.4-nano': { in: 0.2, out: 1.25 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-4o-mini-transcribe': { in: 1.25, out: 5 },
};
const DEFAULT_PRICE = { in: 1, out: 4 };

export function costMicros(model: string, inTokens: number, outTokens: number): number {
  const p = PRICES[model] ?? DEFAULT_PRICE;
  return Math.ceil(inTokens * p.in + outTokens * p.out);
}

/** Rough transcription estimate: $0.003/min (gpt-4o-mini-transcribe); WhatsApp opus is ~2 KB/s. */
export function transcribeCostMicros(bytes: number): number {
  return Math.ceil((bytes / 120_000) * 3000);
}
