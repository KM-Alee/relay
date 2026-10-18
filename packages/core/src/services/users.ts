// Users service (docs/06-security.md §2, F1.*). Owner: Lane B (T-101/T-102 extend it).
// Services return already-masked DTOs shaped by @relay/contracts; route handlers stay thin.
import type { MeResponse } from '@relay/contracts/api/users';
import { PERMISSION_KEYS } from '@relay/contracts/permissions';
import type { Actor } from '../auth/actor';

/** GET /api/v1/me. No DB yet: T-101/T-102 add workspace flags and the effective permission set. */
export function me(actor: Actor): MeResponse {
  return {
    user: {
      id: actor.userId,
      workspaceId: actor.workspaceId,
      baseLevel: actor.baseLevel,
      locale: actor.locale,
    },
    permissions: actor.baseLevel === 'owner' ? [...PERMISSION_KEYS] : [...actor.permissions].sort(),
    flags: {},
  };
}

export const usersService = { me };
