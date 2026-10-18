// Seed: leads demo data. Owner: Lane A (framework: Lane B, T-010). Must be idempotent.
import type { SeedModule } from './types';

export const leadsSeed: SeedModule = {
  name: 'leads',
  run: async () => undefined, // TODO(T-010/T-211): demo rows for leads
};
