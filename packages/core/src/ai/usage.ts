// ai_usage store (I6.4/I6.5): one row per call; the daily cap sums today's rows (workspace day = PKT).
import { aiUsage } from '@relay/db/schema';
import { withWorkspaceTx } from '@relay/db/tx';
import { and, eq, gte, sql } from 'drizzle-orm';

export interface UsageRow {
  task: string;
  model: string;
  promptVersion: string | null;
  status: string; // 'ok' or the AiError
  inTokens: number;
  outTokens: number;
  costMicros: number;
  latencyMs: number;
}

export interface UsageStore {
  spentSince(workspaceId: string, since: Date): Promise<number>;
  record(workspaceId: string, row: UsageRow): Promise<void>;
}

const PKT_OFFSET_MS = 5 * 3600_000;
/** Start of the current day in Pakistan time (UTC+5, no DST) as a UTC instant. */
export function dayStart(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + PKT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - PKT_OFFSET_MS);
}

export const dbUsageStore: UsageStore = {
  async spentSince(workspaceId, since) {
    return withWorkspaceTx(workspaceId, async (tx) => {
      const [r] = await tx
        .select({ s: sql<string>`coalesce(sum(${aiUsage.costMicros}), 0)` })
        .from(aiUsage)
        .where(and(eq(aiUsage.workspaceId, workspaceId), gte(aiUsage.createdAt, since)));
      return Number(r?.s ?? 0);
    });
  },
  async record(workspaceId, row) {
    await withWorkspaceTx(workspaceId, async (tx) => {
      await tx.insert(aiUsage).values({ workspaceId, ...row });
    });
  },
};

/** In-memory store for tests and `pnpm ai:eval`. */
export class MemoryUsageStore implements UsageStore {
  rows: (UsageRow & { workspaceId: string; at: Date })[] = [];
  async spentSince(workspaceId: string, since: Date) {
    return this.rows
      .filter((r) => r.workspaceId === workspaceId && r.at >= since)
      .reduce((a, r) => a + r.costMicros, 0);
  }
  async record(workspaceId: string, row: UsageRow) {
    this.rows.push({ ...row, workspaceId, at: new Date() });
  }
}
