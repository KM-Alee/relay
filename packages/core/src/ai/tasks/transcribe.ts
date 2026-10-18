// Voice-note transcription (F8.1, T-217). Same guard rails as runAiTask: kill switch, daily cap, usage
// log (I6.5), one retry for async jobs (I6.7). Never throws; returns {ok:false} so the caller marks the
// message `transcript_status='failed'` (audio stays playable, Retry button).
// Model default `gpt-4o-mini-transcribe` ($1.25/M audio tokens, verified 2026-10-18; Urdu supported).
import { config } from '../../config';
import { log } from '../../log';
import { FakeAIProvider } from '../fake';
import { OpenAIProvider } from '../openai';
import { aiEnabled, type AiDeps } from '../run';
import type { AIProvider, AiResult } from '../types';
import { dayStart, dbUsageStore } from '../usage';

export const TRANSCRIBE_PROMPT_VERSION = 'transcription@v1';
/** OpenAI audio upload limit. Bigger files are not transcribed (shown as failed with a reason). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const URDU_PROMPT =
  'Customer voice note for a business in Pakistan, spoken in Urdu, Roman Urdu or English. Write Urdu in Urdu script (اردو), never Devanagari.';
const DEVANAGARI = /[\u0900-\u097F]/;

let shared: { key: string; p: AIProvider } | undefined;
function provider(): AIProvider | undefined {
  const c = config.ai;
  if (c.INTEGRATIONS_FAKE) return new FakeAIProvider();
  if (!c.OPENAI_API_KEY) return undefined;
  if (shared?.key !== c.OPENAI_API_KEY)
    shared = { key: c.OPENAI_API_KEY, p: new OpenAIProvider(c.OPENAI_API_KEY) };
  return shared.p;
}

export async function transcribeAudio(a: {
  workspaceId: string;
  audio: Uint8Array;
  mime: string;
  languageHint?: 'ur' | 'en';
  deps?: AiDeps;
}): Promise<AiResult<string>> {
  const d = a.deps ?? {};
  if (!aiEnabled(d)) return { ok: false, error: 'disabled' };
  if (a.audio.byteLength > MAX_AUDIO_BYTES)
    return { ok: false, error: 'invalid_output', detail: 'too_large' };
  try {
    const p = d.provider ?? provider();
    if (!p) return { ok: false, error: 'disabled', detail: 'no provider configured' };
    const usage = d.usage ?? dbUsageStore;
    const cap = d.capMicros ?? Math.round(config.ai.AI_DEFAULT_DAILY_COST_CAP_USD * 1_000_000);
    const spent = await usage.spentSince(a.workspaceId, dayStart()).catch(() => 0);
    if (spent >= cap) return { ok: false, error: 'budget' };

    const model = config.ai.OPENAI_MODEL_TRANSCRIBE;
    // Pakistani voice notes mix Urdu, Roman Urdu and English; without a bias the model often answers in
    // Devanagari (Hindi). The prompt steers the script; a Devanagari result is re-run once as Urdu.
    const req = {
      model,
      audio: a.audio,
      mime: a.mime,
      languageHint: a.languageHint,
      prompt: URDU_PROMPT,
      timeoutMs: 30_000,
    };
    let res = await p.transcribe(req);
    if (res.ok && !a.languageHint && DEVANAGARI.test(res.value)) {
      const again = await p.transcribe({ ...req, languageHint: 'ur' });
      if (again.ok)
        res = {
          ...again,
          usage: { ...again.usage, costMicros: again.usage.costMicros + res.usage.costMicros },
        };
    }
    if (!res.ok && (res.error === 'timeout' || res.error === 'rate_limited' || res.error === 'provider')) {
      await new Promise((r) => setTimeout(r, 500));
      res = await p.transcribe(req);
    }
    await usage
      .record(a.workspaceId, {
        task: 'transcription',
        model,
        promptVersion: TRANSCRIBE_PROMPT_VERSION,
        status: res.ok ? 'ok' : res.error,
        inTokens: res.ok ? res.usage.inTokens : 0,
        outTokens: res.ok ? res.usage.outTokens : 0,
        costMicros: res.ok ? res.usage.costMicros : 0,
        latencyMs: res.ok ? res.latencyMs : 0,
      })
      .catch((e) => log.warn('ai usage write failed', { err: e }));
    if (!res.ok) log.warn('ai transcribe failed', { error: res.error, detail: res.detail });
    return res;
  } catch (e) {
    log.warn('ai transcribe crashed', { err: e });
    return { ok: false, error: 'provider', detail: 'internal' };
  }
}
