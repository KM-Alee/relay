// Dev login support (13 §5). Owner: Lane B. T-010 returns the seeded users (one per level + Manager);
// T-101 adds `loginAs(userId)` creating a real session. Callers MUST guard with the dev-tools check.
export interface SeedUserSummary {
  userId: string;
  email: string;
  displayName: string;
  baseLevel: 'owner' | 'admin' | 'user';
  workspaceName: string;
}

export const devLoginService = {
  async listSeedUsers(): Promise<SeedUserSummary[]> {
    return []; // TODO(T-010): query seeded users via withSystemTx
  },
};
