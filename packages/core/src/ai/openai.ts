// OpenAI implementation of AIProvider (I6.1: server-side only). Chat Completions + strict JSON-schema
// structured outputs (I6.3); the output is ALWAYS re-validated with Zod. No tools / function calling.
import OpenAI from 'openai';
import { costMicros, transcribeCostMicros } from './pricing';
import type { AIProvider, AiError, AiJsonRequest, AiResult } from './types';

function mapError(e: unknown): { ok: false; error: AiError; detail?: string } {
  const err = e as { name?: string; status?: number; message?: string };
  const detail = (err.message ?? String(e)).slice(0, 200); // never includes the key
  if (err.name === 'APIConnectionTimeoutError' || err.name === 'AbortError')
    return { ok: false, error: 'timeout', detail };
  if (err.status === 429) return { ok: false, error: 'rate_limited', detail };
  return { ok: false, error: 'provider', detail };
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 0 }); // retries are ours (run.ts), async jobs only
  }

  async json<T>(i: AiJsonRequest<T>): Promise<AiResult<T>> {
    const t0 = Date.now();
    try {
      const reasoning = /^(gpt-5|o\d)/.test(i.model);
      const res = await this.client.chat.completions.create(
        {
          model: i.model,
          messages: [{ role: 'system', content: i.system }, ...i.input],
          response_format: {
            type: 'json_schema',
            json_schema: { name: i.task, strict: true, schema: i.jsonSchema },
          },
          max_completion_tokens: reasoning ? i.maxOutputTokens * 4 : i.maxOutputTokens,
          ...(reasoning ? { reasoning_effort: 'minimal' as const } : { temperature: 0.3 }),
        },
        { timeout: i.timeoutMs },
      );
      const latencyMs = Date.now() - t0;
      const inTokens = res.usage?.prompt_tokens ?? 0;
      const outTokens = res.usage?.completion_tokens ?? 0;
      const usage = { inTokens, outTokens, costMicros: costMicros(i.model, inTokens, outTokens) };
      const msg = res.choices[0]?.message;
      if (msg?.refusal) return { ok: false, error: 'refused', detail: msg.refusal.slice(0, 200) };
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg?.content ?? '');
      } catch {
        return { ok: false, error: 'invalid_output', detail: (msg?.content ?? '').slice(0, 500) };
      }
      const v = i.schema.safeParse(parsed);
      if (!v.success) {
        return {
          ok: false,
          error: 'invalid_output',
          detail: v.error.issues
            .map((x) => x.path.join('.'))
            .join(',')
            .slice(0, 200),
        };
      }
      return { ok: true, value: v.data, usage, latencyMs, model: i.model };
    } catch (e) {
      return mapError(e);
    }
  }

  async transcribe(i: Parameters<AIProvider['transcribe']>[0]): Promise<AiResult<string>> {
    const t0 = Date.now();
    try {
      const ext = i.mime.includes('ogg')
        ? 'ogg'
        : i.mime.includes('mp4') || i.mime.includes('aac')
          ? 'm4a'
          : i.mime.includes('webm')
            ? 'webm'
            : 'mp3';
      const file = new File([Buffer.from(i.audio)], `audio.${ext}`, { type: i.mime });
      const res = await this.client.audio.transcriptions.create(
        {
          model: i.model,
          file,
          ...(i.languageHint ? { language: i.languageHint } : {}),
          ...(i.prompt ? { prompt: i.prompt } : {}),
        },
        { timeout: i.timeoutMs },
      );
      return {
        ok: true,
        value: res.text,
        usage: { inTokens: 0, outTokens: 0, costMicros: transcribeCostMicros(i.audio.byteLength) },
        latencyMs: Date.now() - t0,
        model: i.model,
      };
    } catch (e) {
      return mapError(e);
    }
  }
}
