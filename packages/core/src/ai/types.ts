// AI layer types (docs/05-ai.md §3). Owner: Lane C2.
import type { ZodType } from 'zod';

export type AiTask =
  'triage' | 'standin_reply' | 'handoff_brief' | 'field_fill' | 'onboarding_proposal' | 'transcription';
/** Customer language / script: Urdu script, Roman Urdu, English (F7.5). */
export type Lang = 'en' | 'ur' | 'ur-Latn';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiUsage {
  inTokens: number;
  outTokens: number;
  costMicros: number;
}

export type AiError =
  | 'disabled'
  | 'timeout'
  | 'rate_limited'
  | 'invalid_output'
  | 'refused'
  | 'budget'
  | 'breaker_open'
  | 'provider';

export type AiResult<T> =
  | { ok: true; value: T; usage: AiUsage; latencyMs: number; model: string }
  | { ok: false; error: AiError; detail?: string };

export interface AiJsonRequest<T> {
  task: AiTask;
  model: string;
  system: string;
  input: AiMessage[];
  schema: ZodType<T>;
  /** Strict-mode JSON schema (see schemaToJson). */
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AIProvider {
  json<T>(i: AiJsonRequest<T>): Promise<AiResult<T>>;
  transcribe(i: {
    model: string;
    audio: Uint8Array;
    mime: string;
    languageHint?: 'ur' | 'en';
    /** Biases the transcription (style/script), never instructions. */
    prompt?: string;
    timeoutMs: number;
  }): Promise<AiResult<string>>;
}
