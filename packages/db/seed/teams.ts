// Seed: teams demo data. Owner: Lane A (framework: Lane B, T-010). Must be idempotent.
import type { SeedModule } from './types';

export const teamsSeed: SeedModule = {
  name: 'teams',
  run: async () => undefined, // TODO(T-010/T-211): demo rows for teams
};
