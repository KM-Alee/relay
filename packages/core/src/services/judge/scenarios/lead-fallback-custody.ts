// F3.4 / rubric 3: nobody is available, the lead still has an accountable human (fallback custody).
// PLACEHOLDER (T-209). Lane A: replace `run` with a real scenario using core/services/leads (see judge/README in registry.ts).
import { pending, type JudgeScenario } from '../types';

export const leadFallbackCustody: JudgeScenario = {
  id: 'lead-fallback-custody',
  criterion: 3,
  reqs: ['F3.4', 'INV-1'],
  expected: 'Everyone offline: the lead goes to the fallback custodian (never ownerless) and shows why',
  async run() {
    return pending('pending: lead engine not deployed');
  },
};
