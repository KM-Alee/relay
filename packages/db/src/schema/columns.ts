// Custom column types Drizzle lacks (shared helper, NOT re-exported from schema/index.ts so names never
// clash across domain files). Import directly: `import { bytea, citext, inet } from './columns'`.
// Added by Lane B (T-007/T-101); other lanes may import freely.
import { customType } from 'drizzle-orm/pg-core';

/** Postgres bytea ⇄ Node Buffer (token hashes, audit hashes, encrypted secrets). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** citext (case-insensitive text; extension created by the identity migration). */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** inet as text. */
export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});
