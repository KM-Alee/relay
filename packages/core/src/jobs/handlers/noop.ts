// Example handler: copy this file for a new job type (`core/jobs/handlers/<type>.ts`), then add ONE
// line to ../registry.ts. Used by tests and the tick smoke check.
import { z } from 'zod';
import { defineJob } from '../types';

export const noopJob = defineJob({
  type: 'system.noop',
  payload: z.object({ note: z.string().max(200).optional() }),
  handle: async () => undefined,
});
