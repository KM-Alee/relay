// [Q14] Migration runner: filename order, recorded once, edits detected, late-merged older files applied.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureDatabase, listMigrationFiles, runMigrations, withDatabaseName } from '../../src/migrate';
import { testDbUrls } from '../db-urls';

const dbName = `${testDbUrls().database}_mig_${process.pid}`;
const url = withDatabaseName(testDbUrls().ownerUrl, dbName);
let dir: string;

async function q(text: string): Promise<pg.QueryResult> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'relay-mig-'));
  await ensureDatabase(url);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: withDatabaseName(url, 'postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

describe('[Q14] migration runner', () => {
  it('[Q14] applies files in filename order and records them once', async () => {
    await writeFile(path.join(dir, '202601010900_b_second.sql'), 'INSERT INTO t VALUES (2);');
    await writeFile(
      path.join(dir, '202601010800_a_first.sql'),
      'CREATE TABLE t (v int); INSERT INTO t VALUES (1);',
    );
    const first = await runMigrations({ connectionString: url, dir });
    expect(first.applied).toEqual(['202601010800_a_first.sql', '202601010900_b_second.sql']);
    const again = await runMigrations({ connectionString: url, dir });
    expect(again).toEqual({ applied: [], skipped: 2 });
    expect((await q('SELECT v FROM t ORDER BY v')).rows).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it('[Q14] applies a late-merged file with an older timestamp (parallel lanes)', async () => {
    await writeFile(path.join(dir, '202601010850_c_late.sql'), 'INSERT INTO t VALUES (3);');
    const res = await runMigrations({ connectionString: url, dir });
    expect(res.applied).toEqual(['202601010850_c_late.sql']);
  });

  it('[Q14] refuses an applied migration that was edited', async () => {
    await writeFile(path.join(dir, '202601010900_b_second.sql'), 'INSERT INTO t VALUES (22);');
    await expect(runMigrations({ connectionString: url, dir })).rejects.toThrow(
      /edited after it was applied/,
    );
  });

  it('[Q14] a failing migration rolls back and is not recorded', async () => {
    await writeFile(path.join(dir, '202601010900_b_second.sql'), 'INSERT INTO t VALUES (2);');
    await writeFile(path.join(dir, '202601011000_d_broken.sql'), 'INSERT INTO t VALUES (4); SELECT nope();');
    await expect(runMigrations({ connectionString: url, dir })).rejects.toThrow(
      /202601011000_d_broken.sql failed/,
    );
    expect((await q('SELECT count(*)::int AS n FROM t WHERE v = 4')).rows[0]).toEqual({ n: 0 });
    await rm(path.join(dir, '202601011000_d_broken.sql'));
  });

  it('[Q14] rejects badly named files', async () => {
    await writeFile(path.join(dir, '0001_roles.sql'), 'select 1;');
    await expect(listMigrationFiles(dir)).rejects.toThrow(/Invalid migration filename/);
    await rm(path.join(dir, '0001_roles.sql'));
  });

  it('[Q14] the repo migrations are all validly named', async () => {
    const files = await listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
  });
});
