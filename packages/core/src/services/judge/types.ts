// Judge Console scenario contract (F10.1, docs/08-testing.md §6). Owner: Lane B (T-209).
// A scenario runs server-side in the judge's own workspace against the REAL code paths and returns
// expected-vs-actual plus evidence links. Throwaway records are tagged `judge` and cleaned up.
import type { JudgeCriterion, JudgeEvidenceLinkDto, JudgeRunResult } from '@relay/contracts/api/judge';
import type { Actor } from '../../auth/actor';

export interface JudgeCtx {
  /** The judge (Owner of the workspace); every scenario is scoped to `actor.workspaceId`. */
  actor: Actor;
  /** Origin of the current request, for scenarios that call the public HTTP API. */
  origin: string;
  /** Records a timestamped step (shown in the UI). */
  step: (label: string, ok: boolean, detail?: string) => void;
}

export interface ScenarioOutcome {
  status: JudgeRunResult['status'];
  /** Technical, language-neutral summary of what was observed. */
  actual: string;
  evidence?: JudgeEvidenceLinkDto[];
}

export interface JudgeScenario {
  /** kebab-case, stable: the client keys titles/descriptions/expectations on it. */
  id: string;
  criterion: JudgeCriterion;
  reqs: string[];
  /** English technical "expected" line (the UI shows a localized one; this is the audit/API fallback). */
  expected: string;
  run(ctx: JudgeCtx): Promise<ScenarioOutcome>;
}

export const pass = (actual: string, evidence?: JudgeEvidenceLinkDto[]): ScenarioOutcome => ({
  status: 'pass',
  actual,
  evidence,
});
export const fail = (actual: string, evidence?: JudgeEvidenceLinkDto[]): ScenarioOutcome => ({
  status: 'fail',
  actual,
  evidence,
});
export const pending = (actual: string): ScenarioOutcome => ({ status: 'pending', actual });
