// Fixture builders for Judge Console contracts (13 §4). Owner: Lane B (T-209).
import type { JudgeListResponse, JudgeRunResult } from '../api/judge';

export const judgeFixtures = {
  list: (): JudgeListResponse => ({
    scenarios: [{ id: 'cross-workspace', criterion: 1, reqs: ['F1.6'] }],
  }),
  run: (): JudgeRunResult => ({
    id: 'cross-workspace',
    status: 'pass',
    expected: 'GET of another workspace record id: 404',
    actual: 'service: 404 NOT_FOUND; raw SQL under RLS: 0 rows',
    steps: [
      {
        label: 'Service read of that id as the judge',
        ok: true,
        detail: 'HTTP 404',
        at: '2026-10-18T10:00:00.000Z',
      },
    ],
    evidence: [{ key: 'audit', href: '/audit' }],
    startedAt: '2026-10-18T10:00:00.000Z',
    durationMs: 12,
  }),
};
