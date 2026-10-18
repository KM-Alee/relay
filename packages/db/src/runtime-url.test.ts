import { describe, expect, it } from 'vitest';
import { runtimeDatabaseUrl } from './runtime-url';

const owner =
  'postgres://neondb_owner:ownerpw@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

describe('[Q6][Q18] runtimeDatabaseUrl', () => {
  it('[Q6] rewrites the owner user/password to app_user, keeping host, db and params', () => {
    const u = new URL(runtimeDatabaseUrl({ DATABASE_URL: owner, APP_DB_PASSWORD: 'p@ss/w:rd' })!);
    expect(u.username).toBe('app_user');
    expect(decodeURIComponent(u.password)).toBe('p@ss/w:rd');
    expect(u.host).toBe('ep-x-pooler.ap-southeast-1.aws.neon.tech');
    expect(u.pathname).toBe('/neondb');
    expect(u.searchParams.get('sslmode')).toBe('require');
  });

  it('[Q6] leaves an app_user URL untouched', () => {
    const url = 'postgres://app_user:x@h/db';
    expect(runtimeDatabaseUrl({ DATABASE_URL: url, APP_DB_PASSWORD: 'other' })).toBe(url);
  });

  it('[Q6] without APP_DB_PASSWORD the URL is returned as is (config then rejects a non-app_user user)', () => {
    expect(runtimeDatabaseUrl({ DATABASE_URL: owner })).toBe(owner);
    expect(runtimeDatabaseUrl({ DATABASE_URL: owner, APP_DB_PASSWORD: '  ' })).toBe(owner);
  });

  it('[Q18] is undefined when DATABASE_URL is unset or blank', () => {
    expect(runtimeDatabaseUrl({})).toBeUndefined();
    expect(runtimeDatabaseUrl({ DATABASE_URL: ' ' })).toBeUndefined();
  });
});
