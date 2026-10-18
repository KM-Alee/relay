// Seed: crm demo data. Owner: Lane B (framework: Lane B, T-010). Must be idempotent.
import type { SeedModule } from './types';

export const crmSeed: SeedModule = {
  name: 'crm',
  run: async () => undefined, // TODO(T-010/T-211): demo rows for crm
};
