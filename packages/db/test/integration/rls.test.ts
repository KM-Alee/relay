// [F1.6][Q6] Row-level security harness (docs/06-security.md §3 "Testing RLS").
// Code under test connects as app_user (DATABASE_URL = TEST_DATABASE_URL); fixtures use the owner.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, withSystemTx, withWorkspaceTx, type Tx } from '../../src/index';
import { workspaces } from '../../src/schema/index';
import { withOwner } from '../helpers';

// A sample workspace-scoped table, created exactly as lanes do it (template + helper).
const PROBE = 'rls_probe';

const wsA = randomUUID();
const wsB = randomUUID();
const rowA = randomUUID();
const rowB = randomUUID();

async function rows(tx: Tx, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const res = await tx.execute(query);
  return res.rows;
}

beforeAll(async () => {
  await withOwner(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS ${PROBE} (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES workspaces (id),
        label text NOT NULL,
        UNIQUE (workspace_id, id)
      )`);
    await c.query(`SELECT relay_enable_tenant_rls('${PROBE}')`);
  });
  // Workspaces are created through the runtime path (app_user + withWorkspaceTx), like signup will.
  for (const [id, row, label] of [
    [wsA, rowA, 'A'],
    [wsB, rowB, 'B'],
  ] as const) {
    await withWorkspaceTx(id, async (tx) => {
      await tx.insert(workspaces).values({ id, name: `RLS ${label}`, slug: `rls-${id}` });
      await tx.execute(sql`insert into rls_probe (id, workspace_id, label) values (${row}, ${id}, ${label})`);
    });
  }
});

afterAll(async () => {
  await closeDb();
});

describe('[F1.6] tenant isolation as app_user', () => {
  it('[F1.6][Q6] runtime connection is app_user without BYPASSRLS or superuser', async () => {
    const [r] = await withSystemTx((tx) =>
      rows(
        tx,
        sql`select current_user as u, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user`,
      ),
    );
    expect(r).toEqual({ u: 'app_user', rolsuper: false, rolbypassrls: false });
  });

  it("[F1.6] app_user cannot read another workspace's row even with WHERE id=", async () => {
    const got = await withWorkspaceTx(wsA, (tx) =>
      rows(tx, sql`select id from rls_probe where id = ${rowB}`),
    );
    expect(got).toEqual([]);
    const own = await withWorkspaceTx(wsA, (tx) => rows(tx, sql`select id, label from rls_probe`));
    expect(own).toEqual([{ id: rowA, label: 'A' }]);
  });

  it("[F1.6] app_user cannot read another workspace's workspaces row", async () => {
    const got = await withWorkspaceTx(wsA, (tx) => tx.select().from(workspaces));
    expect(got.map((w) => w.id)).toEqual([wsA]);
  });

  it("[F1.6] insert with another workspace's workspace_id fails WITH CHECK", async () => {
    const err: unknown = await withWorkspaceTx(wsA, (tx) =>
      tx.execute(sql`insert into rls_probe (id, workspace_id, label) values (${randomUUID()}, ${wsB}, 'x')`),
    ).catch((e: unknown) => e);
    // Drizzle wraps the driver error; 42501 = insufficient_privilege ("violates row-level security policy").
    expect((err as { cause?: { code?: string; message?: string } }).cause).toMatchObject({
      code: '42501',
      message: expect.stringMatching(/row-level security/),
    });
  });

  it("[F1.6] update/delete of another workspace's row affects 0 rows", async () => {
    const upd = await withWorkspaceTx(wsA, (tx) =>
      tx.execute(sql`update rls_probe set label = 'pwned' where id = ${rowB}`),
    );
    const del = await withWorkspaceTx(wsA, (tx) => tx.execute(sql`delete from rls_probe where id = ${rowB}`));
    expect(upd.rowCount).toBe(0);
    expect(del.rowCount).toBe(0);
    const still = await withWorkspaceTx(wsB, (tx) => rows(tx, sql`select label from rls_probe`));
    expect(still).toEqual([{ label: 'B' }]);
  });

  it('[F1.6] no workspace context → 0 rows (fails closed)', async () => {
    const got = await withSystemTx((tx) => rows(tx, sql`select id from rls_probe`));
    expect(got).toEqual([]);
  });

  it('[F1.6] context is transaction-local: a reused pooled connection does not leak it', async () => {
    // One-connection pool guarantees the second transaction reuses the first one's session.
    const single = createDb({ connectionString: process.env.DATABASE_URL!, max: 1 });
    try {
      await withWorkspaceTx(wsA, (tx) => rows(tx, sql`select 1`), { db: single.db });
      const plain = await single.db.transaction((tx) =>
        rows(tx, sql`select id, current_setting('app.workspace_id', true) as ctx from rls_probe`),
      );
      expect(plain).toEqual([]);
    } finally {
      await single.pool.end();
    }
  });

  it('[F1.6] withWorkspaceTx rejects a non-UUID workspace id', async () => {
    await expect(withWorkspaceTx("x' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });
});
