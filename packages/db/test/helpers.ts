// Integration-test helpers. The OWNER connection is for fixtures/DDL only; code under test runs as app_user.
import pg from 'pg';
import { testDbUrls } from './db-urls';

export async function withOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: testDbUrls().ownerUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
