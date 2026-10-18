// Fixture builders for users contracts (13 §4). Deterministic, schema-valid, overridable.
import { PERMISSION_KEYS } from '../permissions';
import type { MeResponse } from '../api/users';

export const FIXTURE_WORKSPACE_ID = '0192f3a0-0000-7000-8000-000000000001';
export const FIXTURE_OWNER_ID = '0192f3a0-0000-7000-8000-000000000101';

export function buildMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: FIXTURE_OWNER_ID, workspaceId: FIXTURE_WORKSPACE_ID, baseLevel: 'owner', locale: 'en' },
    permissions: [...PERMISSION_KEYS],
    flags: {},
    ...overrides,
  };
}

/** One entry per endpoint in usersEndpoints, used by the api-client in fixture mode. */
export const usersFixtures = {
  me: () => buildMe(),
};
