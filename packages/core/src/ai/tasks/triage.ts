// Triage (F6.6, T-205): language, intent, urgency, sentiment, wantsHuman, one-line summary.
// Pure analysis: the caller decides what to do (e.g. call leadsRepo.setUrgent(source:'ai') when
// `shouldMarkUrgent`). The AI never touches the lead engine (AGENTS rule 7).
import { asksForHuman } from '../guards';
import { detect, detectFromMessages } from '../lang';
import { runAiTask, type AiDeps } from '../run';
import { triageSchema, type Triage } from '../schemas';
import { conversationBlock, type Turn } from './context';

export interface TriageInput {
  workspaceId: string;
  /** Last messages, oldest first; the final customer message is the one being triaged. */
  messages: Turn[];
  deps?: AiDeps;
}

export interface TriageResult extends Triage {
  source: 'ai' | 'heuristic';
  promptVersion?: string;
  costMicros?: number;
  latencyMs?: number;
}

const ANGRY_RE =
  /\b(?:fraud|scam|cheat(?:ed|ers?)?|useless|worst|pathetic|ridiculous|unacceptable|furious|disgusting)\b|دھوکہ|بکواس|\b(?:dhoka|dhokha|bakwas|bekar|bekaar|ghatiya|bura)\b/i;
const URGENT_RE =
  /\b(?:urgent|urgently|asap|emergency|immediately|right now|today)\b|\b(?:jaldi|foran|fori|abhi|aaj hi|emergency)\b|فوری|جلدی|ابھی/i;

/** Deterministic fallback when AI is off/slow/over budget (docs/05 §12). */
export function heuristicTriage(messages: Turn[]): Triage {
  const customer = messages.filter((m) => m.role === 'customer').map((m) => m.text);
  const last = customer.at(-1) ?? '';
  const wantsHuman = asksForHuman(last);
  const angry = ANGRY_RE.test(last);
  return {
    language: detectFromMessages(customer),
    intent: /refund|complain|shikayat|شکایت|not working|kharab|خراب/i.test(last) ? 'complaint' : 'other',
    urgency: URGENT_RE.test(last) ? 'high' : 'normal',
    sentiment: angry ? 'angry' : 'neutral',
    wantsHuman,
    summary: last.replace(/\s+/g, ' ').slice(0, 140),
  };
}

export async function triageMessage(i: TriageInput): Promise<TriageResult> {
  const turns = i.messages.slice(-6);
  const res = await runAiTask({
    workspaceId: i.workspaceId,
    task: 'triage',
    modelSlot: 'triage',
    userContent: conversationBlock(turns, 6),
    schema: triageSchema,
    timeoutMs: 4000,
    maxOutputTokens: 200,
    retry: false,
    deps: i.deps,
  });
  if (!res.ok) return { ...heuristicTriage(i.messages), source: 'heuristic' };
  const v = res.value;
  const lastCustomer = [...turns].reverse().find((t) => t.role === 'customer')?.text ?? '';
  // Hard evidence (Urdu script) beats the model's label; the code-level human-request backstop is OR-ed in.
  const language = lastCustomer && detect(lastCustomer) === 'ur' ? 'ur' : v.language;
  return {
    ...v,
    language,
    wantsHuman: v.wantsHuman || asksForHuman(lastCustomer),
    source: 'ai',
    promptVersion: res.promptVersion,
    costMicros: res.usage.costMicros,
    latencyMs: res.latencyMs,
  };
}

/** F6.6: urgent or angry messages set the lead urgent (caller applies via leadsRepo.setUrgent). */
export const shouldMarkUrgent = (t: Triage): boolean => t.urgency === 'high' || t.sentiment === 'angry';
