// Fixture builders for users contracts (13 §4). Deterministic, schema-valid, overridable.
import { PERMISSION_KEYS } from '../permissions';
import type { MeResponse, SessionSummary, UserSummary } from '../api/users';

export const FIXTURE_WORKSPACE_ID = '0192f3a0-0000-7000-8000-000000000001';
export const FIXTURE_OWNER_ID = '0192f3a0-0000-7000-8000-000000000101';
export const FIXTURE_USER_ID = '0192f3a0-0000-7000-8000-000000000104';
export const FIXTURE_SESSION_ID = '0192f3a0-0000-7000-8000-000000000301';

export function buildMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: {
      id: FIXTURE_OWNER_ID,
      workspaceId: FIXTURE_WORKSPACE_ID,
      baseLevel: 'owner',
      locale: 'en',
      name: 'Ayesha Khan',
      email: 'owner@sunrise.test',
      timezone: 'Asia/Karachi',
      availability: 'available',
    },
    workspace: {
      id: FIXTURE_WORKSPACE_ID,
      name: 'Sunrise Solar',
      slug: 'sunrise-solar',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      defaultLocale: 'en',
      demoMode: true,
    },
    permissions: [...PERMISSION_KEYS],
    flags: {},
    ...overrides,
  };
}

export function buildSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: FIXTURE_SESSION_ID,
    createdAt: '2026-10-18T09:00:00.000Z',
    lastSeenAt: '2026-10-18T10:00:00.000Z',
    expiresAt: '2026-11-17T09:00:00.000Z',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Fixture)',
    current: true,
    ...overrides,
  };
}

export function buildUserSummary(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: FIXTURE_OWNER_ID,
    name: 'Ayesha Khan',
    email: 'owner@sunrise.test',
    baseLevel: 'owner',
    availability: 'available',
    isActive: true,
    locale: 'en',
    roles: [],
    version: 0,
    ...overrides,
  };
}

/** One entry per endpoint in usersEndpoints, used by the api-client in fixture mode. */
export const usersFixtures = {
  me: () => buildMe(),
  mySessions: () => ({
    items: [
      buildSession(),
      buildSession({
        id: '0192f3a0-0000-7000-8000-000000000302',
        current: false,
        userAgent: 'Mozilla/5.0 (Phone)',
      }),
    ],
  }),
  revokeMySession: () => undefined,
  list: () => ({
    items: [
      buildUserSummary(),
      buildUserSummary({
        id: FIXTURE_USER_ID,
        name: 'Bilal Ahmed',
        email: 'user@sunrise.test',
        baseLevel: 'user',
        availability: 'busy',
      }),
    ],
    nextCursor: null,
  }),
  get: () => buildUserSummary(),
};
