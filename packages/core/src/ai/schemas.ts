// Zod output schemas for AI tasks (docs/05-ai.md §2). The schemas deliberately contain NO action
// fields (payments, bookings, discounts, assignment, opt-out): a forbidden action cannot be expressed
// (F6.8, AGENTS rule 7). Strict-mode friendly: every property required, optionals are nullable.
import { z } from 'zod';

export const langSchema = z.enum(['ur', 'ur-Latn', 'en']);

export const triageSchema = z.object({
  language: langSchema,
  intent: z.enum(['buy', 'price', 'booking', 'complaint', 'other']),
  urgency: z.enum(['low', 'normal', 'high']),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'angry']),
  wantsHuman: z.boolean(),
  summary: z.string().max(140),
});
export type Triage = z.infer<typeof triageSchema>;

export const standInSchema = z.object({
  reply: z.string().min(1).max(600),
  answeredFromKb: z.array(z.string()),
  collected: z.array(z.object({ fieldKey: z.string().max(60), value: z.string().max(200) })).max(8),
  askedQuestionKey: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  handoff: z.object({
    needed: z.boolean(),
    reason: z.enum(['asked_human', 'anger', 'complaint', 'low_confidence', 'out_of_scope']).nullable(),
  }),
});
export type StandInOutput = z.infer<typeof standInSchema>;

export const briefSchema = z.object({
  goal: z.string().max(120),
  mood: z.string().max(40),
  summary: z.string().max(300),
  suggestedReply: z.string().max(400),
  language: langSchema,
});
export type Brief = z.infer<typeof briefSchema>;

const UNSUPPORTED = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'format',
  'pattern',
  '$schema',
  'exclusiveMinimum',
  'exclusiveMaximum',
];

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED.includes(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)]));
    } else out[k] = clean(v);
  }
  return out;
}

/** Zod -> OpenAI strict JSON schema (constraints stripped; Zod still enforces them on the output). */
export function schemaToJson(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: 'draft-7' })) as Record<string, unknown>;
}
