// Test DB resolution (docs/13-parallel-development.md §6: per-worktree databases).
// The DB NAME comes from TEST_DATABASE_URL (app_user); owner credentials/host from
// TEST_DATABASE_URL_UNPOOLED. Defaults match docker-compose + .env.example for a fresh clone.
//
// Linked git worktrees get their own DB automatically: if the checkout is a worktree (`.git` is a
// file) and the name has no worktree suffix yet (scripts/wt.sh writes `_t<n>`), `_wt_<dirname>` is
// appended. So Agent-tool worktrees (.claude/worktrees/<name>) never share `relay_test`.
import { statSync } from 'node:fs';
import path from 'node:path';
import { databaseNameOf, isLocalDatabaseUrl, withDatabaseName } from '../src/migrate';

const DEFAULT_APP = 'postgres://app_user:app_user_dev@localhost:5432/relay_test';
const DEFAULT_OWNER = 'postgres://postgres:postgres@localhost:5432/relay_test';
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function isLinkedWorktree(root: string): boolean {
  try {
    return statSync(path.join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

/** `relay_test` → `relay_test_wt_<slug>` inside a linked worktree (max 63 chars, Postgres limit). */
export function worktreeDatabaseName(database: string, root = REPO_ROOT): string {
  if (/_t\d+$/.test(database) || /_wt_[a-z0-9_]+$/.test(database) || !isLinkedWorktree(root)) return database;
  const slug = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${database}_wt_${slug}`.slice(0, 63);
}

export function testDbUrls(): { appUrl: string; ownerUrl: string; database: string } {
  const rawApp = process.env.TEST_DATABASE_URL || DEFAULT_APP;
  const database = worktreeDatabaseName(databaseNameOf(rawApp));
  const appUrl = withDatabaseName(rawApp, database);
  const ownerUrl = withDatabaseName(process.env.TEST_DATABASE_URL_UNPOOLED || DEFAULT_OWNER, database);
  if (!isLocalDatabaseUrl(ownerUrl) && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new Error(
      'Integration tests refuse a non-local DB unless ALLOW_REMOTE_TEST_DB=1 (e.g. Neon CI branch).',
    );
  }
  return { appUrl, ownerUrl, database };
}
