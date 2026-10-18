// Judge Console service (F10.1; docs/08-testing.md §6). Owner: Lane B (T-209).
// Gate: permission `demo.judge_console` AND DEMO_MODE. Each run is audited (`judge.scenario_run`).
// Scenarios use real code paths in the judge's own workspace; throwaway records are tagged `[judge]`.
import type { JudgeListResponse, JudgeRunResult } from '@relay/contracts/api/judge';
import { withWorkspaceTx } from '@relay/db';
import * as audit from '../audit';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { config } from '../config';
import { AppError, notFound } from '../errors';
import { log } from '../log';
import { findScenario, SCENARIOS } from './judge/registry';
import type { JudgeCtx } from './judge/types';

function gate(actor: Actor): void {
  assertPermission(actor, 'demo.judge_console');
  // The console is a demo tool: invisible (404) where DEMO_MODE is off.
  if (!config.core.DEMO_MODE) throw notFound();
}

export function list(actor: Actor): JudgeListResponse {
  gate(actor);
  return { scenarios: SCENARIOS.map((s) => ({ id: s.id, criterion: s.criterion, reqs: s.reqs })) };
}

export async function run(actor: Actor, id: string, origin: string): Promise<JudgeRunResult> {
  gate(actor);
  const scenario = findScenario(id);
  if (!scenario) throw notFound();
  const steps: JudgeRunResult['steps'] = [];
  const started = new Date();
  const ctx: JudgeCtx = {
    actor,
    origin,
    step: (label, ok, detail) => steps.push({ label, ok, detail, at: new Date().toISOString() }),
  };
  let outcome: Awaited<ReturnType<typeof scenario.run>>;
  try {
    outcome = await scenario.run(ctx);
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') throw err;
    log.warn('judge.scenario_threw', { scenario: id, err });
    const msg = err instanceof Error ? err.message : String(err);
    ctx.step('Scenario crashed', false, msg.slice(0, 200));
    outcome = { status: 'fail', actual: `error: ${msg.slice(0, 200)}` };
  }
  const result: JudgeRunResult = {
    id,
    status: outcome.status,
    expected: scenario.expected,
    actual: outcome.actual,
    steps,
    evidence: outcome.evidence ?? [],
    startedAt: started.toISOString(),
    durationMs: Date.now() - started.getTime(),
  };
  await withWorkspaceTx(actor.workspaceId, (tx) =>
    audit.append(tx, actor, {
      action: 'judge.scenario_run',
      targetType: 'judge',
      targetId: null,
      after: { scenario: id, status: result.status, durationMs: result.durationMs },
    }),
  );
  return result;
}

export const judgeService = { list, run };
