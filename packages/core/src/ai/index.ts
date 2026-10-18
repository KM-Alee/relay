// AI layer public API (docs/05-ai.md). Owner: Lane C2. Import via `@relay/core/ai`.
// Invariant: nothing here acknowledges, owns, stops timers, sends, books, quotes or charges. Callers
// (lead engine / messaging lanes) decide what to do with the returned data.
export { aiEnabled, runAiTask, type AiDeps } from './run';
export { OpenAIProvider } from './openai';
export { FakeAIProvider } from './fake';
export { MemoryUsageStore, dbUsageStore, dayStart, type UsageStore } from './usage';
export { costMicros, PRICES } from './pricing';
export { detect, detectFromMessages, arabicRatio } from './lang';
export { checkReply, asksForHuman, type GuardResult, type Violation } from './guards';
export { fallbackReply, holdingReply, disclosure, humanJoined } from './templates';
export { getPrompt, CURRENT as PROMPT_VERSIONS } from './prompts/registry';
export { triageSchema, standInSchema, briefSchema, type Triage, type Brief } from './schemas';
export {
  triageMessage,
  heuristicTriage,
  shouldMarkUrgent,
  type TriageInput,
  type TriageResult,
} from './tasks/triage';
export {
  generateStandInReply,
  type KbEntry,
  type StandInInput,
  type StandInResult,
  type HandoffReason,
} from './tasks/standin';
export {
  generateHandoffBrief,
  baselineBrief,
  type HandoffBrief,
  type HandoffBriefInput,
} from './tasks/handoff';
export type { Turn } from './tasks/context';
export type { AIProvider, AiResult, AiError, AiTask, Lang } from './types';
