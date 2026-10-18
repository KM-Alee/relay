// Seed: identity demo data. Owner: Lane B (framework: Lane B, T-010). Must be idempotent.
import type { SeedModule } from './types';

export const identitySeed: SeedModule = {
  name: 'identity',
  run: async () => undefined, // TODO(T-010/T-211): demo rows for identity
};
