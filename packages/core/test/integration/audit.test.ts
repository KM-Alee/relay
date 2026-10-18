// [F4.1][F4.3][F4.4] Audit log core on real Postgres. Code under test runs as app_user; the tamper
// steps run as the OWNER (like the Judge Console demo script, never the app).
import { randomUUID } from 'node:crypto';
import { closeDb, withSystemTx, withWorkspaceTx } from '@relay/db';
import { workspaces } from '@relay/db/schema';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import { append, systemActor, verifyChain } from '../../src/audit/index';
import type { Actor } from '../../src/auth/actor';
import { auditService } from '../../src/services/audit';

afterAll(async () => {
  await closeDb();
});

async function newWorkspace(): Promise<string> {
  const id = randomUUID();
  await withWorkspaceTx(id, async (tx) => {
    await tx.insert(workspaces).values({ id, name: `Audit ${id}`, slug: `audit-${id}` });
  });
  return id;
}

async function appendN(ws: string, n: number): Promise<number[]> {
  const seqs: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await withWorkspaceTx(ws, (tx) =>
      append(tx, systemActor(ws), {
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: ws,
        before: { name: `v${i}` },
        after: { name: `v${i + 1}` },
        meta: { i },
      }),
    );
    seqs.push(r.seq);
  }
  return seqs;
}

const verify = (ws: string) => withWorkspaceTx(ws, (tx) => verifyChain(tx, ws));

/** Owner-only tamper: disable the immutability trigger inside ONE transaction, change, re-enable. */
async function ownerTamper(statement: string, params: unknown[]): Promise<void> {
  await withOwner(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query('ALTER TABLE audit_events DISABLE TRIGGER audit_no_update');
      await c.query(statement, params);
      await c.query('ALTER TABLE audit_events ENABLE TRIGGER audit_no_update');
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

const pgCode = (e: unknown) =>
  (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

describe('[F4.4] hash chain', () => {
  it('[F4.4] appends get seq 1..n per workspace, linked by prev_hash, and verify ok', async () => {
    const ws = await newWorkspace();
    expect(await appendN(ws, 5)).toEqual([1, 2, 3, 4, 5]);
    const rows = await withWorkspaceTx(ws, (tx) =>
      tx.execute<{ seq: string; prev_hash: Buffer; hash: Buffer }>(
        sql`select seq, prev_hash, hash from audit_events where workspace_id = ${ws} order by seq`,
      ),
    );
    expect(rows.rows[0]!.prev_hash.equals(Buffer.from([0]))).toBe(true);
    for (let i = 1; i < rows.rows.length; i++)
      expect(rows.rows[i]!.prev_hash.equals(rows.rows[i - 1]!.hash)).toBe(true);
    expect(await verify(ws)).toEqual({
      ok: true,
      checked: 5,
      firstBrokenSeq: null,
      expectedHash: null,
      storedHash: null,
    });
  });

  it('[F4.4] chains are per workspace (seq restarts at 1)', async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    await appendN(a, 2);
    expect(await appendN(b, 1)).toEqual([1]);
  });

  it('[F4.4] concurrent appends in one workspace serialize: contiguous seqs, valid chain', async () => {
    const ws = await newWorkspace();
    const out = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withWorkspaceTx(ws, (tx) =>
          append(tx, systemActor(ws), { action: 'judge.scenario_run', targetType: 'scenario', meta: { i } }),
        ),
      ),
    );
    expect(out.map((r) => r.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect((await verify(ws)).ok).toBe(true);
  });

  it('[F4.4] content tampered by the owner is detected at the right seq', async () => {
    const ws = await newWorkspace();
    await appendN(ws, 6);
    await ownerTamper(
      `UPDATE audit_events SET after = '{"name":"forged"}'::jsonb WHERE workspace_id = $1 AND seq = 4`,
      [ws],
    );
    const r = await verify(ws);
    expect(r).toMatchObject({ ok: false, firstBrokenSeq: 4, checked: 4 });
    expect(r.expectedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.storedHash).not.toBe(r.expectedHash);
  });

  it('[F4.4] a re-hashed forgery breaks the next link; a deleted row is reported as missing', async () => {
    const ws = await newWorkspace();
    await appendN(ws, 5);
    // Forge row 2 AND recompute its own hash: its content now verifies, but row 3's prev_hash breaks.
    await ownerTamper(
      `UPDATE audit_events SET meta = '{"i":99}'::jsonb WHERE workspace_id = $1 AND seq = 2`,
      [ws],
    );
    await ownerTamper(
      `UPDATE audit_events a SET hash = audit_row_hash(a) WHERE workspace_id = $1 AND seq = 2`,
      [ws],
    );
    expect(await verify(ws)).toMatchObject({ ok: false, firstBrokenSeq: 3 });

    const ws2 = await newWorkspace();
    await appendN(ws2, 4);
    await ownerTamper(`DELETE FROM audit_events WHERE workspace_id = $1 AND seq = 3`, [ws2]);
    expect(await verify(ws2)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it('[F4.4] verify pages through the chain (page size smaller than the row count)', async () => {
    const ws = await newWorkspace();
    await appendN(ws, 7);
    expect(await withWorkspaceTx(ws, (tx) => verifyChain(tx, ws, 3))).toMatchObject({ ok: true, checked: 7 });
  });
});

describe('[F4.3] append-only', () => {
  it('[F4.3] UPDATE, DELETE and TRUNCATE as app_user fail', async () => {
    const ws = await newWorkspace();
    await appendN(ws, 1);
    for (const stmt of [
      sql`update audit_events set action = 'x.y' where workspace_id = ${ws}`,
      sql`delete from audit_events where workspace_id = ${ws}`,
      sql`truncate audit_events`,
    ]) {
      const err = await withWorkspaceTx(ws, (tx) => tx.execute(stmt)).catch((e: unknown) => e);
      expect(pgCode(err)).toBe('42501'); // insufficient_privilege: no grant
    }
    expect((await verify(ws)).checked).toBe(1);
  });

  it('[F4.3] even the owner role cannot UPDATE/DELETE while the trigger is on', async () => {
    const ws = await newWorkspace();
    await appendN(ws, 1);
    for (const stmt of [
      `UPDATE audit_events SET action = 'x.y' WHERE workspace_id = $1`,
      `DELETE FROM audit_events WHERE workspace_id = $1`,
    ]) {
      const err = await withOwner((c) => c.query(stmt, [ws])).catch((e: unknown) => e);
      expect(String((err as Error).message)).toMatch(/append-only/);
    }
  });

  it('[F4.3] app_user cannot supply its own seq/hash: the trigger overwrites them', async () => {
    const ws = await newWorkspace();
    await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`insert into audit_events (workspace_id, seq, actor_type, action, target_type, prev_hash, hash)
                     values (${ws}, 999, 'system', 'judge.scenario_run', 'scenario', '\\x01'::bytea, '\\x02'::bytea)`),
    );
    const r = await verify(ws);
    expect(r).toMatchObject({ ok: true, checked: 1 });
  });

  it("[F1.6][F4.3] cannot append into another workspace's chain", async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    const err = await withWorkspaceTx(a, (tx) =>
      append(tx, systemActor(b), { action: 'judge.scenario_run', targetType: 'scenario' }),
    ).catch((e: unknown) => e);
    expect(pgCode(err)).toBe('42501');
    const none = await withSystemTx((tx) => tx.execute(sql`select count(*)::int as n from audit_events`));
    expect(none.rows[0]).toEqual({ n: 0 }); // no context → no rows visible
  });

  it('[F4.2][F1.5] verify requires audit.view (Admin lacks it by default; Owner has it)', async () => {
    const ws = await newWorkspace();
    const admin: Actor = {
      userId: randomUUID(),
      workspaceId: ws,
      sessionId: 's',
      baseLevel: 'admin',
      permissions: new Set(['users.manage']),
      locale: 'en',
    };
    await expect(auditService.verify(admin)).rejects.toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
    await expect(auditService.verify({ ...admin, baseLevel: 'owner' })).resolves.toMatchObject({ ok: true });
  });
});
