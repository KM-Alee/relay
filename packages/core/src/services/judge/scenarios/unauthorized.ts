// F1.5 / rubric 1: an unauthorized API call is rejected (401 signed out, 403 without the permission).
import { auditService } from '../../audit';
import { integrationsService } from '../../integrations';
import { expectError, plainUser } from '../helpers';
import { fail, pass, type JudgeScenario } from '../types';

async function anon(origin: string, path: string, init?: RequestInit): Promise<number> {
  try {
    const r = await fetch(new URL(path, origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      ...init,
    });
    return r.status;
  } catch {
    return 0;
  }
}

export const unauthorized: JudgeScenario = {
  id: 'unauthorized',
  criterion: 1,
  reqs: ['F1.5', 'Q1'],
  expected: 'No session: 401. Plain User calling owner-only actions: 403 FORBIDDEN',
  async run({ actor, origin, step }) {
    const user = plainUser(actor);
    const noSession = await anon(origin, '/api/v1/audit');
    step('GET /api/v1/audit with no session cookie', noSession === 401, `HTTP ${noSession}`);
    const noSessionWrite = await anon(origin, '/api/v1/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"x"}',
    });
    step(
      'POST /api/v1/contacts with no session cookie',
      noSessionWrite === 401 || noSessionWrite === 403,
      `HTTP ${noSessionWrite}`,
    );
    const audit = await expectError(() => auditService.list(user, {}));
    step('Plain User reads the audit log', audit.status === 403, `HTTP ${audit.status} ${audit.code}`);
    const breaker = await expectError(() => integrationsService.forceBreaker(user, 'stripe', 'open'));
    step(
      'Plain User forces a provider breaker',
      breaker.status === 403,
      `HTTP ${breaker.status} ${breaker.code}`,
    );

    const ok =
      noSession === 401 &&
      (noSessionWrite === 401 || noSessionWrite === 403) &&
      audit.status === 403 &&
      breaker.status === 403;
    const actual = `signed-out GET ${noSession}, signed-out POST ${noSessionWrite}, user audit ${audit.status}, user breaker ${breaker.status}`;
    return ok ? pass(actual) : fail(actual);
  },
};
