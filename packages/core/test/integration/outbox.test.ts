// [Q5][F3.8][I5.5] Outbox + runDueWork on real Postgres, as app_user.
// Each test owns a fresh workspace and scopes every tick to it (parallel files never collide).
import { closeDb, withSystemTx, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueWith } from '../../src/jobs/outbox';
import { claimOutboxBatch } from '../../src/jobs/outbox-processor';
import { DeferJobError, PermanentJobError } from '../../src/jobs/policy';
import { createJobRegistry } from '../../src/jobs/registry';
import { runDueWork, type RunDueWorkOptions } from '../../src/jobs/run-due-work';
import { defineJob } from '../../src/jobs/types';
import * as outboxRepo from '../../src/repos/outbox';
import {
  createWorkspace,
  ctxFor,
  deferred,
  expireLeases,
  makeDue,
  outboxRows,
  owner,
  sleep,
} from '../helpers/jobs';

// ── test handlers ───────────────────────────────────────────────────────
const calls = new Map<string, number>();
const bump = (key: string) => calls.set(key, (calls.get(key) ?? 0) + 1);
let hangGate = deferred();
let hangEntered = deferred();

const registry = createJobRegistry([
  defineJob({
    type: 'test.count',
    payload: z.object({ key: z.string(), jitterMs: z.number().int().max(50).optional() }),
    handle: async ({ key, jitterMs }) => {
      if (jitterMs) await sleep(Math.floor(Math.random() * jitterMs));
      bump(key);
    },
  }),
  defineJob({
    type: 'test.fail',
    payload: z.object({ key: z.string() }),
    handle: async ({ key }) => {
      bump(key);
      throw new Error('boom');
    },
  }),
  defineJob({
    type: 'test.permanent',
    payload: z.object({ key: z.string() }),
    handle: async ({ key }) => {
      bump(key);
      throw new PermanentJobError('provider said 400');
    },
  }),
  defineJob({
    type: 'test.defer',
    payload: z.object({ key: z.string() }),
    handle: async ({ key }) => {
      bump(key);
      throw new DeferJobError(5_000, 'breaker open');
    },
  }),
  defineJob({
    type: 'test.strict',
    payload: z.object({ n: z.number() }),
    handle: async () => void bump('strict'),
  }),
  defineJob({
    type: 'test.hang',
    payload: z.object({ key: z.string() }),
    // First call freezes (a stuck instance); later calls complete immediately.
    handle: async ({ key }) => {
      bump(key);
      if (calls.get(key) === 1) {
        hangEntered.resolve();
        await hangGate.promise;
      }
    },
  }),
  defineJob({ type: 'test.gone', payload: z.object({}), handle: async () => undefined }),
]);
const registryWithoutGone = createJobRegistry([...registry.values()].filter((h) => h.type !== 'test.gone'));

let ws: string;
const tick = (over: Partial<RunDueWorkOptions> = {}) =>
  runDueWork({
    trigger: 'dev',
    scope: { workspaceIds: [ws] },
    registry,
    scheduler: null,
    budgetMs: 15_000,
    random: () => 0.5,
    ...over,
  });
const enqueue = (
  type: string,
  payload: unknown,
  opts: { dedupeKey?: string; maxAttempts?: number; availableAt?: Date } = {},
) => withWorkspaceTx(ws, (tx) => enqueueWith(tx, { type, payload, ...opts }, registry));

beforeEach(async () => {
  calls.clear();
  ws = await createWorkspace();
});

afterAll(async () => {
  await closeDb();
});

describe('[Q5] outbox enqueue', () => {
  it('[Q5] the row commits with the caller tx and takes its workspace; a rollback leaves nothing', async () => {
    const { id } = await enqueue('test.count', { key: 'a' });
    await expect(
      withWorkspaceTx(ws, async (tx) => {
        await enqueueWith(tx, { type: 'test.count', payload: { key: 'b' } }, registry);
        throw new Error('state change failed');
      }),
    ).rejects.toThrow('state change failed');
    const rows = await outboxRows(ws);
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0]).toMatchObject({ workspace_id: ws, status: 'pending', attempts: 0, max_attempts: 6 });
  });

  it('[Q5] a duplicate dedupe_key is a silent no-op', async () => {
    const a = await enqueue('test.count', { key: 'a' }, { dedupeKey: `dd:${ws}` });
    const b = await enqueue('test.count', { key: 'a' }, { dedupeKey: `dd:${ws}` });
    expect(a.deduped).toBe(false);
    expect(b).toEqual({ id: null, deduped: true });
    expect(await outboxRows(ws)).toHaveLength(1);
  });

  it('[Q5] an invalid payload fails at enqueue time (in the caller), not later', async () => {
    await expect(enqueue('test.strict', { n: 'not a number' })).rejects.toThrow(/invalid payload/);
    await expect(enqueue('nope.never', {})).rejects.toThrow(/unknown job type/);
    expect(await outboxRows(ws)).toHaveLength(0);
  });
});

describe('[Q5] [F3.8] exactly-once processing', () => {
  it('[Q5] [F3.8] concurrent ticks process each outbox row exactly once', async () => {
    const N = 40;
    for (let i = 0; i < N; i++) await enqueue('test.count', { key: `k${i}`, jitterMs: 15 });

    const results = await Promise.all([
      tick({ batchSize: 3 }),
      tick({ batchSize: 3 }),
      tick({ batchSize: 4 }),
    ]);

    expect(results.reduce((n, r) => n + r.outboxProcessed, 0)).toBe(N);
    for (let i = 0; i < N; i++) expect(calls.get(`k${i}`), `k${i}`).toBe(1);
    const rows = await outboxRows(ws);
    expect(rows.every((r) => r.status === 'done' && r.attempts === 1 && r.locked_until === null)).toBe(true);
    // More than one tick did real work: the race was real.
    expect(results.filter((r) => r.outboxProcessed > 0).length).toBeGreaterThan(1);
  });

  it('[Q5] crash after claim, before commit of the outcome: reprocessed exactly once after lease expiry', async () => {
    await enqueue('test.count', { key: 'crash' });

    // Tick #1 claims (claim COMMITS), then the instance dies before delivering/recording anything.
    const claimed = await claimOutboxBatch(ctxFor(ws, registry));
    expect(claimed).toHaveLength(1);
    expect((await outboxRows(ws))[0]).toMatchObject({ status: 'in_flight', attempts: 1 });

    // While the lease holds, nobody else touches it.
    expect((await tick()).outboxProcessed).toBe(0);
    expect(calls.get('crash')).toBeUndefined();

    // Lease expires → two racing ticks: exactly one reprocesses it.
    await expireLeases(ws);
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a.outboxProcessed + b.outboxProcessed).toBe(1);
    expect(calls.get('crash')).toBe(1);
    expect((await outboxRows(ws))[0]).toMatchObject({ status: 'done', attempts: 2 });

    // And never again.
    expect((await tick()).outboxProcessed).toBe(0);
    expect(calls.get('crash')).toBe(1);
  });

  it("[Q5] a frozen worker whose lease expired cannot overwrite the new owner's outcome (fencing)", async () => {
    hangGate = deferred();
    hangEntered = deferred();
    await enqueue('test.hang', { key: 'hang' });

    const stuck = tick({ leaseSeconds: 1 }); // first claim, 1 s lease, handler freezes
    await hangEntered.promise;
    await sleep(1_100); // lease runs out (DB clock)

    const second = await tick(); // reclaims (attempt 2) and completes
    expect(second.outboxProcessed).toBe(1);
    const afterSecond = (await outboxRows(ws))[0]!;
    expect(afterSecond).toMatchObject({ status: 'done', attempts: 2 });

    hangGate.resolve(); // the stale worker wakes up and tries to mark attempt 1 done
    await stuck;
    const final = (await outboxRows(ws))[0]!;
    expect(final).toMatchObject({ status: 'done', attempts: 2 });
    expect(final.done_at).toEqual(afterSecond.done_at); // outcome recorded once, by the live owner
  });

  it('[Q5] an expired lease on the FINAL attempt is dead-lettered, not retried forever', async () => {
    await enqueue('test.count', { key: 'poison' }, { maxAttempts: 1 });
    await claimOutboxBatch(ctxFor(ws, registry)); // crash
    await expireLeases(ws);
    expect((await tick()).outboxProcessed).toBe(0);
    expect(calls.get('poison')).toBeUndefined();
    const row = (await outboxRows(ws))[0]!;
    expect(row.status).toBe('dead');
    expect(row.last_error).toMatch(/lease expired on the final attempt/);
  });
});

describe('[I5.5] retries, backoff, dead-letter', () => {
  it('[I5.5] a failing job is retried with exponential backoff, then marked dead after max_attempts', async () => {
    await enqueue('test.fail', { key: 'f' }, { maxAttempts: 3 });

    await tick();
    let row = (await outboxRows(ws))[0]!;
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Error: boom' });
    expect(row.available_in_ms).toBeGreaterThan(3_000); // 2^1 × 2 s = 4 s (jitter pinned)
    expect(row.available_in_ms).toBeLessThanOrEqual(4_100);
    expect((await tick()).outboxProcessed).toBe(0); // not due yet

    await makeDue(ws);
    await tick();
    row = (await outboxRows(ws))[0]!;
    expect(row).toMatchObject({ status: 'pending', attempts: 2 });
    expect(row.available_in_ms).toBeGreaterThan(7_000); // 8 s
    expect(row.available_in_ms).toBeLessThanOrEqual(8_100);

    await makeDue(ws);
    await tick();
    row = (await outboxRows(ws))[0]!;
    expect(row).toMatchObject({ status: 'dead', attempts: 3, last_error: 'Error: boom' });
    expect(row.done_at).not.toBeNull();
    expect(calls.get('f')).toBe(3);

    await makeDue(ws);
    expect((await tick()).outboxProcessed).toBe(0);
  });

  it('[I5.5] a permanent error fails immediately (no retry)', async () => {
    await enqueue('test.permanent', { key: 'p' });
    await tick();
    const row = (await outboxRows(ws))[0]!;
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row.last_error).toMatch(/provider said 400/);
    expect(calls.get('p')).toBe(1);
  });

  it('[I5.5] a payload that no longer parses is dead-lettered without calling the handler', async () => {
    const { id } = await enqueue('test.strict', { n: 1 });
    await owner(`update outbox set payload = '{"n":"x"}' where id = $1`, [id]);
    await tick();
    expect((await outboxRows(ws))[0]).toMatchObject({ status: 'dead', attempts: 1 });
    expect(calls.get('strict')).toBeUndefined();
  });

  it('[I5.5] an unknown type (deploy skew) is retried with backoff, not dropped', async () => {
    await enqueue('test.gone', {});
    await tick({ registry: registryWithoutGone });
    const row = (await outboxRows(ws))[0]!;
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.last_error).toMatch(/unknown job type: test\.gone/);
    await makeDue(ws);
    await tick(); // the new code knows it
    expect((await outboxRows(ws))[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('[I5.8] a deferred job (breaker open) is rescheduled without consuming an attempt', async () => {
    await enqueue('test.defer', { key: 'd' }, { maxAttempts: 1 });
    await tick();
    await makeDue(ws);
    await tick();
    const row = (await outboxRows(ws))[0]!;
    expect(row).toMatchObject({ status: 'pending', attempts: 0, last_error: 'DeferJobError: breaker open' });
    expect(row.available_in_ms).toBeGreaterThan(4_000);
    expect(calls.get('d')).toBe(2);
  });

  it('[I5.5] availableAt in the future is not delivered early', async () => {
    await enqueue('test.count', { key: 'later' }, { availableAt: new Date(Date.now() + 60_000) });
    const r = await tick();
    expect(r.outboxProcessed).toBe(0);
    expect(new Date(r.nextDueAt!).getTime()).toBeGreaterThan(Date.now() + 55_000);
  });
});

describe('[Q5] job_runs heartbeat', () => {
  it('[Q5] every tick records trigger, budget, counts and duration', async () => {
    await enqueue('test.count', { key: 'h1' });
    await enqueue('test.count', { key: 'h2' });
    const r = await tick({ trigger: 'nudge', budgetMs: 7_000 });
    const [run] = await owner<Record<string, unknown>>(`select * from job_runs where id = $1`, [r.runId]);
    expect(run).toMatchObject({
      trigger: 'nudge',
      budget_ms: 7_000,
      outbox_processed: 2,
      leads_processed: 0,
      error: null,
    });
    expect(run!.finished_at).not.toBeNull();
    expect(Number(run!.duration_ms)).toBeGreaterThanOrEqual(0);
    expect(run!.details).toMatchObject({ processors: { outbox: { processed: 2 } } });
  });

  it('[Q5] only known triggers are accepted by the table', async () => {
    await expect(
      withSystemTx((tx) => tx.execute(sql`insert into job_runs (trigger, budget_ms) values ('bogus', 1)`)),
    ).rejects.toThrow();
  });
});

describe('[F1.6] outbox tenant isolation (RLS)', () => {
  it('[F1.6] a workspace tx sees only its own rows; a system tx sees only system rows', async () => {
    const other = await createWorkspace();
    await enqueue('test.count', { key: 'mine' });
    await withWorkspaceTx(other, (tx) =>
      enqueueWith(tx, { type: 'test.count', payload: { key: 'x' } }, registry),
    );
    const { id: sysId } = await withSystemTx((tx) =>
      enqueueWith(tx, { type: 'test.count', payload: { key: 'sys' } }, registry),
    );

    const mine = await withWorkspaceTx(ws, (tx) => outboxRepo.countByStatus(tx));
    expect(mine.pending).toBe(1);
    const sysVisible = await withSystemTx(
      async (tx) => (await tx.execute<{ id: string }>(sql`select id from outbox where id = ${sysId}`)).rows,
    );
    expect(sysVisible).toHaveLength(1);
    const wsSeesSys = await withWorkspaceTx(
      ws,
      async (tx) =>
        (await tx.execute(sql`select id from outbox where workspace_id is null and id = ${sysId}`)).rows,
    );
    expect(wsSeesSys).toHaveLength(0);
    const sysSeesWs = await withSystemTx(
      async (tx) => (await tx.execute(sql`select id from outbox where workspace_id = ${ws}`)).rows,
    );
    expect(sysSeesWs).toHaveLength(0);
    await owner(`delete from outbox where id = $1`, [sysId]); // keep system rows clean for others
  });

  it('[F1.6] app_user cannot enqueue into another workspace or delete outbox rows', async () => {
    const other = await createWorkspace();
    await expect(
      withWorkspaceTx(ws, (tx) =>
        tx.execute(sql`insert into outbox (workspace_id, type) values (${other}, 'test.count')`),
      ),
    ).rejects.toThrow();
    await enqueue('test.count', { key: 'del' });
    await expect(withWorkspaceTx(ws, (tx) => tx.execute(sql`delete from outbox`))).rejects.toThrow();
  });
});
