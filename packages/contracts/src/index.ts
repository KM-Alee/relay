// @relay/contracts: Zod schemas + TS types shared by client and server. NO server deps.
// Shared file: one export line per module (docs/13-parallel-development.md §2).
// Domain contracts are imported by subpath to avoid name clashes:
//   import { meResponse, usersEndpoints } from '@relay/contracts/api/users';
//   import { usersFixtures } from '@relay/contracts/fixtures/users';
export * from './errors';
export * from './permissions';
export * from './api/endpoint';
