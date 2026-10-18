// AI stand-in reply (F6.1-F6.13, T-206 core). `generateStandInReply` NEVER throws and ALWAYS returns
// text that is safe to send: model output only if it passes every guard, otherwise a static localized
// template. It does not send, ack, own, or touch timers: the caller (messaging lane) enforces the trigger
// (F6.2), opt-out (I1.9), 24 h window (F6.8) and rate limits, then stores a messages(author_type='ai').
import { asksForHuman, checkReply, type Violation } from '../guards';
import { detectFromMessages } from '../lang';
import { runAiTask, type AiDeps } from '../run';
import { standInSchema } from '../schemas';
import { disclosure, fallbackReply, holdingReply } from '../templates';
import type { AiError, Lang } from '../types';
import type { Triage } from '../schemas';
import { block, conversationBlock, type Turn } from './context';

export interface KbEntry {
  id: string;
  kind: 'pricing' | 'service' | 'faq' | 'hours' | 'area' | string;
  title: string;
  body: string;
}

export interface StandInInput {
  workspaceId: string;
  workspaceName: string;
  /** Target language; default = detected from the customer's latest messages (F7.5). Prefer contacts.language. */
  language?: Lang;
  /** True for the first AI message in this conversation: disclosure is prefixed in code (F6.3). */
  isFirstAiMessage: boolean;
  /** Engine facts (F6.7). `ownerFirstName` ONLY when custody is a real handler; else null. */
  status: { ownerFirstName: string | null; notified: boolean; withinBusinessHours?: boolean };
  knowledge: KbEntry[];
  contact: { name?: string | null };
  /** Already-collected fields, key -> value. No opportunity values. */
  collectedFields: Record<string, string>;
  /** Qualifying questions still open (configured questions minus filled fields). */
  openQuestions: { key: string; label: string }[];
  /** Last <= 10 messages, oldest first; the last one is the customer message being answered. */
  history: Turn[];
  /** Optional triage of the same message (F6.9 hard-handoff signals). */
  triage?: Pick<Triage, 'wantsHuman' | 'sentiment' | 'intent'>;
  allowedPhones?: string[];
  deps?: AiDeps;
}

export type HandoffReason = 'asked_human' | 'anger' | 'complaint' | 'low_confidence' | 'out_of_scope';

export interface StandInResult {
  /** ai = model reply passed all guards; holding = hard handoff; fallback = AI unavailable/unsafe. */
  kind: 'ai' | 'holding' | 'fallback';
  /** Final text to send (disclosure already prefixed when requested). */
  text: string;
  language: Lang;
  handoff: { needed: boolean; reason?: HandoffReason };
  collected: { fieldKey: string; value: string }[];
  askedQuestionKey?: string;
  answeredFromKb: string[];
  confidence?: number;
  guards: Violation[];
  fallbackReason?: AiError | 'guard' | 'handoff';
  /** The model reply the guards rejected (for messages.ai_meta / audit; NEVER send it). */
  blockedReply?: string;
  promptVersion?: string;
  model?: string;
  latencyMs?: number;
  costMicros?: number;
}

const CONFIDENCE_FLOOR = 0.55;

function rankKb(kb: KbEntry[], query: string, maxBytes = 4096): KbEntry[] {
  const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const scored = kb.map((e, i) => {
    const hay = `${e.title} ${e.body}`.toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s++;
    return { e, s, i };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const out: KbEntry[] = [];
  let bytes = 0;
  for (const { e } of scored) {
    const n = Buffer.byteLength(e.title + e.body) + 40;
    if (bytes + n > maxBytes) continue;
    out.push(e);
    bytes += n;
  }
  return out;
}

function buildUserContent(i: StandInInput, lang: Lang, kb: KbEntry[]): string {
  const s = i.status;
  const status = [
    s.ownerFirstName
      ? `assigned_teammate_first_name: ${s.ownerFirstName}`
      : 'assigned_teammate: none yet (say "a team member")',
    `team_notified: ${s.notified ? 'yes' : 'no'}`,
    s.withinBusinessHours === undefined
      ? ''
      : `within_business_hours: ${s.withinBusinessHours ? 'yes' : 'no'}`,
  ]
    .filter(Boolean)
    .join('\n');
  const contact = [
    `name: ${i.contact.name ?? 'unknown'}`,
    ...Object.entries(i.collectedFields).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  return [
    `<target_language>${lang}</target_language>`,
    block(
      'knowledge',
      kb.map((e) => `id=${e.id} kind=${e.kind} title=${e.title}\n${e.body}`).join('\n---\n') || '(empty)',
    ),
    block('contact', contact),
    block('status', status),
    block('open_questions', i.openQuestions.map((q) => `${q.key}: ${q.label}`).join('\n') || '(none)'),
    conversationBlock(i.history, 10),
  ].join('\n');
}

export async function generateStandInReply(i: StandInInput): Promise<StandInResult> {
  const customerTexts = i.history.filter((t) => t.role === 'customer').map((t) => t.text);
  const lastCustomer = customerTexts.at(-1) ?? '';
  const lang: Lang = i.language ?? detectFromMessages(customerTexts);
  const prefix = (t: string) =>
    i.isFirstAiMessage ? `${disclosure(lang, i.workspaceName, i.status.ownerFirstName)}\n\n${t}` : t;
  const base = { language: lang, collected: [], answeredFromKb: [], guards: [] as Violation[] };

  const holding = (reason: HandoffReason, extra: Partial<StandInResult> = {}): StandInResult => ({
    ...base,
    kind: 'holding',
    text: prefix(holdingReply(lang)),
    handoff: { needed: true, reason },
    fallbackReason: 'handoff',
    ...extra,
  });
  const fallback = (
    why: StandInResult['fallbackReason'],
    extra: Partial<StandInResult> = {},
  ): StandInResult => ({
    ...base,
    kind: 'fallback',
    text: prefix(fallbackReply(lang)),
    handoff: { needed: false },
    fallbackReason: why,
    ...extra,
  });

  // Hard handoff decided in code BEFORE spending a model call (F6.9). Does not depend on the model.
  if (asksForHuman(lastCustomer) || i.triage?.wantsHuman) return holding('asked_human');
  if (i.triage?.sentiment === 'angry') return holding('anger');
  if (i.triage?.intent === 'complaint') return holding('complaint');

  const kb = rankKb(i.knowledge, lastCustomer);
  const kbIds = new Set(kb.map((e) => e.id));
  const openKeys = new Set(i.openQuestions.map((q) => q.key));
  const guardCtx = {
    lang,
    priceKnowledge: i.knowledge
      .filter((e) => e.kind === 'pricing' || e.kind === 'service')
      .map((e) => `${e.title}\n${e.body}`),
    allKnowledge: i.knowledge.map((e) => `${e.title}\n${e.body}`),
    allowedNames: i.status.ownerFirstName ? [i.status.ownerFirstName] : [],
    allowedPhones: i.allowedPhones,
  };

  const attempt = () =>
    runAiTask({
      workspaceId: i.workspaceId,
      task: 'standin_reply',
      modelSlot: 'chat',
      userContent: buildUserContent(i, lang, kb),
      schema: standInSchema,
      timeoutMs: 6000,
      maxOutputTokens: 300,
      retry: false,
      deps: i.deps,
    });

  let res = await attempt();
  if (!res.ok) return fallback(res.error);

  let checked = checkReply(res.value.reply, guardCtx);
  if (checked.violations.length === 1 && checked.violations[0] === 'language') {
    // One regeneration for a script mismatch, then the static template (docs/05 §4.5.4).
    const again = await attempt();
    if (!again.ok) return fallback(again.error, { guards: ['language'] });
    res = again;
    checked = checkReply(res.value.reply, guardCtx);
    if (checked.violations.includes('language')) return fallback('guard', { guards: checked.violations });
  }
  const guards = checked.violations;

  const v = res.value;
  const meta = {
    promptVersion: res.promptVersion,
    model: res.model,
    latencyMs: res.latencyMs,
    costMicros: res.usage.costMicros,
    confidence: v.confidence,
    guards,
  };

  // Forbidden commitments / invented facts: the reply is dropped, the customer gets the holding message.
  if (guards.length) return holding('out_of_scope', { ...meta, blockedReply: v.reply });
  if (v.answeredFromKb.some((id) => !kbIds.has(id))) return holding('out_of_scope', meta);
  if (v.handoff.needed) return holding(v.handoff.reason ?? 'low_confidence', meta);
  if (v.confidence < CONFIDENCE_FLOOR) return holding('low_confidence', meta);

  const collected = v.collected
    .filter((c) => openKeys.has(c.fieldKey) && c.value.trim())
    .map((c) => ({ fieldKey: c.fieldKey, value: c.value.trim().slice(0, 200) }));
  return {
    ...base,
    ...meta,
    kind: 'ai',
    text: prefix(checked.text),
    handoff: { needed: false },
    collected,
    askedQuestionKey: v.askedQuestionKey && openKeys.has(v.askedQuestionKey) ? v.askedQuestionKey : undefined,
    answeredFromKb: v.answeredFromKb,
  };
}
