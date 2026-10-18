// Seed: messaging demo data. Owner: Lane C (framework: Lane B, T-010). Must be idempotent.
import type { SeedModule } from './types';

export const messagingSeed: SeedModule = {
  name: 'messaging',
  run: async () => undefined, // TODO(T-010/T-211): demo rows for messaging
};
