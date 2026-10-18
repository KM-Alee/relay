// Fake provider for tests / INTEGRATIONS_FAKE. Returns canned values per task; can simulate failures.
import type { AIProvider, AiError, AiJsonRequest, AiResult, AiTask } from './types';

export class FakeAIProvider implements AIProvider {
  calls: AiTask[] = [];
  constructor(
    private handlers: Partial<Record<AiTask, unknown | ((req: AiJsonRequest<unknown>) => unknown)>> = {},
    private failWith?: AiError,
  ) {}

  async json<T>(i: AiJsonRequest<T>): Promise<AiResult<T>> {
    this.calls.push(i.task);
    if (this.failWith) return { ok: false, error: this.failWith };
    const h = this.handlers[i.task];
    if (h === undefined) return { ok: false, error: 'provider', detail: 'no fake handler' };
    const raw =
      typeof h === 'function'
        ? (h as (r: AiJsonRequest<unknown>) => unknown)(i as AiJsonRequest<unknown>)
        : h;
    const v = i.schema.safeParse(raw);
    if (!v.success) return { ok: false, error: 'invalid_output' };
    return {
      ok: true,
      value: v.data,
      usage: { inTokens: 100, outTokens: 50, costMicros: 100 },
      latencyMs: 1,
      model: 'fake',
    };
  }

  async transcribe(): Promise<AiResult<string>> {
    this.calls.push('transcription');
    if (this.failWith) return { ok: false, error: this.failWith };
    return {
      ok: true,
      value: 'fake transcript',
      usage: { inTokens: 0, outTokens: 0, costMicros: 0 },
      latencyMs: 1,
      model: 'fake',
    };
  }
}
