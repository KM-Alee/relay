// [Q11] Polled change feed on real Postgres as app_user (T-009): emit -> /changes, isolation, pruning.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { workspaces } from '@relay/db/schema';
import { withOwner } from '../../../db/test/helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/auth/actor';
import { emit, pruneRealtimeEvents } from '../../src/realtime';
import { realtimeService } from '../../src/services/realtime';
import { withSystemTx } from '@relay/db';

const wsA = randomUUID();
const wsB = randomUUID();

function actor(workspaceId: string, over: Partial<Actor> = {}): Actor {
  return {
    userId: randomUUID(),
    workspaceId,
    sessionId: randomUUID(),
    baseLevel: 'owner',
    permissions: new Set(),
    locale: 'en',
    ...over,
  };
}

const past = () => new Date(Date.now() - 60_000).toISOString();

beforeAll(async () => {
  for (const [id, label] of [
    [wsA, 'A'],
    [wsB, 'B'],
  ] as const) {
    await withWorkspaceTx(id, (tx) =>
      tx.insert(workspaces).values({ id, name: `RT ${label}`, slug: `rt-${id}` }),
    );
  }
});

afterAll(async () => {
  await closeDb();
});

describe('[Q11] realtime change feed', () => {
  it('[Q11] emit -> changes returns the hint once, then nothing new after the cursor', async () => {
    const a = actor(wsA);
    const leadId = randomUUID();
    const since = past();
    await withWorkspaceTx(wsA, (tx) => emit(tx, { workspaceId: wsA, topic: 'leads', ids: [leadId, leadId] }));

    const first = await realtimeService.changes(a, { since });
    const mine = first.changes.filter((c) => c.ids.includes(leadId));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ topic: 'leads', ids: [leadId] });
    expect(first.reset).toBe(false);

    // Cursor = server `now`: the hint is not returned again.
    const second = await realtimeService.changes(a, { since: first.now });
    expect(second.changes.filter((c) => c.ids.includes(leadId))).toHaveLength(0);
  });

  it('[Q11] no `since` just returns a cursor', async () => {
    const r = await realtimeService.changes(actor(wsA), {});
    expect(r).toMatchObject({ reset: false, changes: [] });
    expect(Number.isNaN(Date.parse(r.now))).toBe(false);
  });

  it('[Q11][F1.6] workspace B never sees workspace A hints (isolation)', async () => {
    const id = randomUUID();
    const since = past();
    await withWorkspaceTx(wsA, (tx) => emit(tx, { workspaceId: wsA, topic: 'contacts', ids: [id] }));
    const b = await realtimeService.changes(actor(wsB), { since });
    expect(b.changes.some((c) => c.ids.includes(id))).toBe(false);
  });

  it('[Q11][F1.6] emitting with another workspace id inside a tx fails RLS WITH CHECK', async () => {
    await expect(
      withWorkspaceTx(wsA, (tx) => emit(tx, { workspaceId: wsB, topic: 'leads', ids: [randomUUID()] })),
    ).rejects.toThrow();
  });

  it('[Q11] a rolled-back change emits nothing (same transaction)', async () => {
    const id = randomUUID();
    const since = past();
    await withWorkspaceTx(wsA, async (tx) => {
      await emit(tx, { workspaceId: wsA, topic: 'leads', ids: [id] });
      throw new Error('boom');
    }).catch(() => undefined);
    const r = await realtimeService.changes(actor(wsA), { since });
    expect(r.changes.some((c) => c.ids.includes(id))).toBe(false);
  });

  it('[Q11][F1.5] topics are filtered by permission; user-addressed hints reach only that user', async () => {
    const id = randomUUID();
    const target = actor(wsA, { baseLevel: 'user', permissions: new Set() });
    const other = actor(wsA, { baseLevel: 'user', permissions: new Set(['crm.contact.view']) });
    const since = past();
    await withWorkspaceTx(wsA, async (tx) => {
      await emit(tx, { workspaceId: wsA, topic: 'contacts', ids: [id] });
      await emit(tx, { workspaceId: wsA, topic: 'notifications', ids: [id], userId: target.userId });
    });
    const t = await realtimeService.changes(target, { since });
    expect(t.changes.filter((c) => c.ids.includes(id)).map((c) => c.topic)).toEqual(['notifications']);
    const o = await realtimeService.changes(other, { since });
    expect(o.changes.filter((c) => c.ids.includes(id)).map((c) => c.topic)).toEqual(['contacts']);
  });

  it('[Q11] more than 100 ids are chunked into several hints', async () => {
    const ids = Array.from({ length: 230 }, () => randomUUID());
    const since = past();
    const rows = await withWorkspaceTx(wsA, (tx) => emit(tx, { workspaceId: wsA, topic: 'leads', ids }));
    expect(rows).toBe(3);
    const r = await realtimeService.changes(actor(wsA), { since });
    const got = r.changes
      .filter((c) => c.ids.some((i) => (ids as string[]).includes(i)))
      .flatMap((c) => c.ids);
    expect(new Set(got)).toEqual(new Set(ids));
  });

  it('[Q11] a cursor older than the retention window, or a flood, yields reset=true', async () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    expect(await realtimeService.changes(actor(wsA), { since: old })).toMatchObject({
      reset: true,
      changes: [],
    });

    const since = past();
    await withOwner((c) =>
      c.query(
        `insert into realtime_events (workspace_id, topic, ids) select $1, 'dashboard', '{}' from generate_series(1, 501)`,
        [wsB],
      ),
    );
    expect(await realtimeService.changes(actor(wsB), { since })).toMatchObject({ reset: true, changes: [] });
  });

  it('[Q11] pruneRealtimeEvents deletes expired hints in every workspace and keeps fresh ones', async () => {
    const stale = randomUUID();
    const fresh = randomUUID();
    await withOwner(async (c) => {
      for (const ws of [wsA, wsB])
        await c.query(
          `insert into realtime_events (workspace_id, topic, ids, occurred_at)
           values ($1, 'leads', array[$2::uuid], now() - interval '20 minutes')`,
          [ws, stale],
        );
    });
    await withWorkspaceTx(wsA, (tx) => emit(tx, { workspaceId: wsA, topic: 'leads', ids: [fresh] }));
    const deleted = await withSystemTx((tx) => pruneRealtimeEvents(tx));
    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = await withOwner((c) =>
      c.query(`select ids from realtime_events where $1::uuid = any(ids) or $2::uuid = any(ids)`, [
        stale,
        fresh,
      ]),
    );
    expect(left.rows.map((r: { ids: string[] }) => r.ids[0])).toEqual([fresh]);
  });

  it('[Q11] app_user cannot delete or update hints directly (append-only for the app)', async () => {
    await expect(
      withWorkspaceTx(wsA, (tx) => tx.execute(sql`delete from realtime_events`)),
    ).rejects.toThrow();
  });
});
