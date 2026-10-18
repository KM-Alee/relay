// F3.8 / rubric 3: two timers firing at once escalate exactly once.
// PLACEHOLDER (T-209). Lane A: replace `run` (e.g. past escalate_at + two concurrent runDueWork -> one `escalation` event).
import { pending, type JudgeScenario } from '../types';

export const leadTimersOnce: JudgeScenario = {
  id: 'lead-timers-once',
  criterion: 3,
  reqs: ['F3.8', 'INV-3'],
  expected:
    'A lead past its escalation deadline, processed by two workers at once, gets exactly 1 escalation event',
  async run() {
    return pending('pending: lead engine not deployed');
  },
};
