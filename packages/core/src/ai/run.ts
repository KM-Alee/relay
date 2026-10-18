// runAiTask: the ONLY entry point to the model (docs/05-ai.md §3). Order: kill switch -> daily cap ->
// prompt -> call (timeout, 1 retry for async) -> Zod validation (inside the provider) -> usage log.
// It never throws: every failure is an `{ok:false}` so callers fall back to static templates.
import type { ZodType } from 'zod';
import { config } from '../config';
import { log } from '../log';
import { FakeAIProvider } from './fake';
import { OpenAIProvider } from './openai';
import { getPrompt, type CURRENT } from './prompts/registry';
import { schemaToJson } from './schemas';
import type { AIProvider, AiResult } from './types';
import { dayStart, dbUsageStore, type UsageStore } from './usage';

export interface AiDeps {
  /** Override AI_ENABLED (tests). */
  enabled?: boolean;
  provider?: AIProvider;
  usage?: UsageStore;
  /** Workspace daily cap in micro-USD (ai_settings); default from AI_DEFAULT_DAILY_COST_CAP_USD. */
  capMicros?: number;
  /** Called once on the first breach of the day (caller notifies Admins + audits ai.budget_reached). */
  onBudgetReached?: (workspaceId: string) => void;
  /** Model overrides (default from config). */
  models?: { chat?: string; triage?: string };
}

export interface RunArgs<T> {
  workspaceId: string;
  task: keyof typeof CURRENT;
  /** Which configured model slot to use. */
  modelSlot: 'chat' | 'triage';
  /** The user message: untrusted data wrapped in delimited blocks (see tasks/context.ts). */
  userContent: string;
  schema: ZodType<T>;
  timeoutMs: number;
  maxOutputTokens: number;
  /** Async outbox jobs retry once on timeout / 429 / 5xx; sync callers fail fast (I6.7). */
  retry?: boolean;
  deps?: AiDeps;
}

let sharedProvider: { key: string; p: AIProvider } | undefined;
function defaultProvider(): AIProvider | undefined {
  const c = config.ai;
  if (c.INTEGRATIONS_FAKE) return new FakeAIProvider();
  if (!c.OPENAI_API_KEY) return undefined;
  if (sharedProvider?.key !== c.OPENAI_API_KEY)
    sharedProvider = { key: c.OPENAI_API_KEY, p: new OpenAIProvider(c.OPENAI_API_KEY) };
  return sharedProvider.p;
}

export function aiEnabled(deps?: AiDeps): boolean {
  return deps?.enabled ?? config.ai.AI_ENABLED;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAiTask<T>(a: RunArgs<T>): Promise<AiResult<T> & { promptVersion?: string }> {
  const d = a.deps ?? {};
  if (!aiEnabled(d)) return { ok: false, error: 'disabled' };
  try {
    const provider = d.provider ?? defaultProvider();
    if (!provider) return { ok: false, error: 'disabled', detail: 'no provider configured' };
    const usage = d.usage ?? dbUsageStore;
    const cap = d.capMicros ?? Math.round(config.ai.AI_DEFAULT_DAILY_COST_CAP_USD * 1_000_000);
    const since = dayStart();

    let spent = 0;
    try {
      spent = await usage.spentSince(a.workspaceId, since);
    } catch (e) {
      log.warn('ai usage read failed; continuing', { err: e });
    }
    if (spent >= cap) return { ok: false, error: 'budget' };

    const prompt = getPrompt(a.task);
    const model = (
      a.modelSlot === 'chat'
        ? (d.models?.chat ?? config.ai.OPENAI_MODEL_CHAT)
        : (d.models?.triage ?? config.ai.OPENAI_MODEL_TRIAGE)
    ) as string;
    const req = {
      task: a.task,
      model,
      system: prompt.system,
      input: [{ role: 'user' as const, content: a.userContent }],
      schema: a.schema,
      jsonSchema: schemaToJson(a.schema),
      timeoutMs: a.timeoutMs,
      maxOutputTokens: a.maxOutputTokens,
    };

    let res = await provider.json(req);
    if (
      !res.ok &&
      a.retry &&
      (res.error === 'timeout' || res.error === 'rate_limited' || res.error === 'provider')
    ) {
      await sleep(400);
      res = await provider.json(req);
    }

    const row = res.ok
      ? { status: 'ok', ...res.usage, latencyMs: res.latencyMs }
      : { status: res.error, inTokens: 0, outTokens: 0, costMicros: 0, latencyMs: 0 };
    try {
      await usage.record(a.workspaceId, { task: a.task, model, promptVersion: prompt.promptVersion, ...row });
    } catch (e) {
      log.warn('ai usage write failed', { err: e });
    }
    if (res.ok && spent < cap && spent + res.usage.costMicros >= cap) d.onBudgetReached?.(a.workspaceId);
    if (!res.ok)
      log.warn('ai call failed', {
        task: a.task,
        error: res.error,
        detail: res.detail,
        promptVersion: prompt.promptVersion,
      });
    return { ...res, promptVersion: prompt.promptVersion };
  } catch (e) {
    log.warn('ai task crashed', { task: a.task, err: e });
    return { ok: false, error: 'provider', detail: 'internal' };
  }
}
