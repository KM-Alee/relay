// F3.6 / rubric 3: marking someone on leave/offline reassigns their leads immediately.
// PLACEHOLDER (T-209). Lane A: replace `run` (give a throwaway user a lead, flip availability, assert reassignment + reason).
import { pending, type JudgeScenario } from '../types';

export const leadAbsenceReassign: JudgeScenario = {
  id: 'lead-absence-reassign',
  criterion: 3,
  reqs: ['F3.6', 'F3.7'],
  expected:
    'Owner set to On leave/Offline: their open leads move to another Available person at once, with the reason recorded',
  async run() {
    return pending('pending: lead engine not deployed');
  },
};
