// wake.schedule {at}: publish a QStash wake-up for `at` if it is earlier than the scheduled one
// (04 §7). 3 attempts; a failure is tolerated (the cron backstop / nudges still run due work).
import { z } from 'zod';
import { getWakeScheduler } from '../../integrations/qstash';
import { scheduleWake, WAKE_JOB_TYPE, WAKE_MAX_ATTEMPTS } from '../scheduler';
import { defineJob } from '../types';

export const wakeScheduleJob = defineJob({
  type: WAKE_JOB_TYPE,
  payload: z.object({ at: z.iso.datetime({ offset: true }) }),
  maxAttempts: WAKE_MAX_ATTEMPTS,
  handle: async ({ at }) => {
    await scheduleWake(new Date(at), { scheduler: getWakeScheduler() });
  },
});
