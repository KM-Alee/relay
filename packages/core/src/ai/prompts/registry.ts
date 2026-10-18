// Prompt registry (docs/05-ai.md §9, Q15). Prompts live in versioned files `<task>/v<N>.md`; never edit
// a released version, add v<N+1> and bump CURRENT. `promptVersion` ("triage@v1") is stored on every call.
import { readFileSync } from 'node:fs';
import type { AiTask } from '../types';

export const CURRENT: Record<Exclude<AiTask, 'transcription'>, number> = {
  triage: 1,
  standin_reply: 1,
  handoff_brief: 1,
};

export interface Prompt {
  task: string;
  version: number;
  promptVersion: string;
  system: string;
  meta: Record<string, string>;
}

const cache = new Map<string, Prompt>();

export function getPrompt(task: keyof typeof CURRENT, version: number = CURRENT[task]): Prompt {
  const key = `${task}@v${version}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = readFileSync(new URL(`./${task}/v${version}.md`, import.meta.url), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const prompt: Prompt = { task, version, promptVersion: key, system: (m?.[2] ?? raw).trim(), meta };
  cache.set(key, prompt);
  return prompt;
}
