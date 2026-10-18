// Handoff card + 2-line brief (F6.10, F9.2, T-207 core). Input contains NO opportunity values (I6.6);
// field values must already be masked by the caller (core/auth/mask.ts). With AI off/slow/over budget
// it returns a baseline built from recorded data so the card and Slack alert are never blocked.
import { checkReply } from '../guards';
import { detectFromMessages } from '../lang';
import { runAiTask, type AiDeps } from '../run';
import { briefSchema, type Triage } from '../schemas';
import type { Lang } from '../types';
import { block, conversationBlock, type Turn } from './context';

export interface HandoffBriefInput {
  workspaceId: string;
  /** Collected fields (already masked), label -> value. */
  fields: Record<string, string>;
  triage?: Pick<Triage, 'intent' | 'sentiment' | 'urgency' | 'summary'>;
  /** Last <= 15 messages, oldest first. */
  history: Turn[];
  language?: Lang;
  /** Slack alerts pass ~1500 so the baseline alert is never late; the card can use the default 5000. */
  timeoutMs?: number;
  deps?: AiDeps;
}

export interface HandoffBrief {
  source: 'ai' | 'baseline';
  goal: string;
  mood: string;
  summary: string;
  /** Empty string when none/blocked by the guards. Editable, never auto-sent. */
  suggestedReply: string;
  language: Lang;
  /** F9.2: two-line text for alerts: "<goal>\n<mood>: <suggestion or summary>". */
  twoLine: string;
  promptVersion?: string;
  costMicros?: number;
}

function twoLine(goal: string, mood: string, suggested: string, summary: string): string {
  return `${goal}\nMood: ${mood}${suggested ? ` | Suggested: ${suggested.slice(0, 160)}` : summary ? ` | ${summary.slice(0, 160)}` : ''}`;
}

export function baselineBrief(
  i: Pick<HandoffBriefInput, 'fields' | 'history' | 'triage' | 'language'>,
): HandoffBrief {
  const customer = i.history.filter((t) => t.role === 'customer').map((t) => t.text);
  const last = (customer.at(-1) ?? '').replace(/\s+/g, ' ').slice(0, 120);
  const goal = i.triage?.summary?.slice(0, 120) || last || 'Customer message';
  const mood = i.triage?.sentiment ?? 'unknown';
  const summary = Object.entries(i.fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')
    .slice(0, 300);
  return {
    source: 'baseline',
    goal,
    mood,
    summary,
    suggestedReply: '',
    language: i.language ?? detectFromMessages(customer),
    twoLine: twoLine(goal, mood, '', summary),
  };
}

export async function generateHandoffBrief(i: HandoffBriefInput): Promise<HandoffBrief> {
  const base = baselineBrief(i);
  const fields =
    Object.entries(i.fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') || '(none)';
  const tri = i.triage
    ? `intent: ${i.triage.intent}\nsentiment: ${i.triage.sentiment}\nurgency: ${i.triage.urgency}\nsummary: ${i.triage.summary}`
    : '(none)';
  const res = await runAiTask({
    workspaceId: i.workspaceId,
    task: 'handoff_brief',
    modelSlot: 'chat',
    userContent: [
      `<target_language>${base.language}</target_language>`,
      block('fields', fields),
      block('triage', tri),
      conversationBlock(i.history, 15),
    ].join('\n'),
    schema: briefSchema,
    timeoutMs: i.timeoutMs ?? 5000,
    maxOutputTokens: 350,
    retry: false,
    deps: i.deps,
  });
  if (!res.ok) return base;
  const v = res.value;
  // The suggested reply is customer-facing text once a human sends it, so it passes the same guards.
  const g = checkReply(v.suggestedReply, {
    lang: v.language,
    priceKnowledge: [],
    allKnowledge: [],
    allowedNames: [],
  });
  const suggestedReply = g.violations.length ? '' : g.text;
  return {
    source: 'ai',
    goal: v.goal,
    mood: v.mood,
    summary: v.summary,
    suggestedReply,
    language: v.language,
    twoLine: twoLine(v.goal, v.mood, suggestedReply, v.summary),
    promptVersion: res.promptVersion,
    costMicros: res.usage.costMicros,
  };
}
