// Judge Console contracts (F10.1, docs/08-testing.md §6, docs/11-api.md). Owner: Lane B (T-209).
// Perm `demo.judge_console` + DEMO_MODE. Scenario titles/descriptions are i18n keys on the client
// (`judge.scenarios.<id>.*`); the server returns ids, grouping and the technical evidence.
import { z } from 'zod';
import { endpoint } from './endpoint';

/** Rubric criterion numbers (docs/14-rubric.md) the console can evidence. */
export const judgeCriterionSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(8),
  z.literal(9),
]);
export type JudgeCriterion = z.infer<typeof judgeCriterionSchema>;

export const judgeScenarioDto = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  criterion: judgeCriterionSchema,
  /** Requirement ids this scenario evidences, e.g. ['I1.8']. */
  reqs: z.array(z.string()),
});
export type JudgeScenarioDto = z.infer<typeof judgeScenarioDto>;

export const judgeListResponse = z.object({
  scenarios: z.array(judgeScenarioDto),
});
export type JudgeListResponse = z.infer<typeof judgeListResponse>;

export const judgeStepDto = z.object({
  label: z.string(),
  ok: z.boolean(),
  detail: z.string().optional(),
  at: z.iso.datetime({ offset: true }),
});
export type JudgeStepDto = z.infer<typeof judgeStepDto>;

/** In-app path (no locale prefix), e.g. '/audit'. The client adds the locale. */
export const judgeEvidenceLinkDto = z.object({
  key: z.enum(['audit', 'syncHistory', 'integrations', 'contact', 'opportunity', 'dashboard', 'team']),
  href: z.string().startsWith('/'),
});
export type JudgeEvidenceLinkDto = z.infer<typeof judgeEvidenceLinkDto>;

export const judgeRunResult = z.object({
  id: z.string(),
  /** pending = the feature is not deployed yet (lead engine scenarios). */
  status: z.enum(['pass', 'fail', 'pending']),
  expected: z.string(),
  actual: z.string(),
  steps: z.array(judgeStepDto),
  evidence: z.array(judgeEvidenceLinkDto),
  startedAt: z.iso.datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
});
export type JudgeRunResult = z.infer<typeof judgeRunResult>;

export const judgeParams = z.object({ scenario: z.string().regex(/^[a-z0-9-]+$/) }).strict();

export const judgeEndpoints = {
  /** GET /api/v1/judge: scenario registry (perm demo.judge_console, DEMO_MODE). */
  list: endpoint({ method: 'GET', path: '/api/v1/judge', response: judgeListResponse }),
  /** POST /api/v1/judge/:scenario: run one scenario against the caller's workspace. */
  run: endpoint({
    method: 'POST',
    path: '/api/v1/judge/:scenario',
    params: judgeParams,
    response: judgeRunResult,
  }),
} as const;
