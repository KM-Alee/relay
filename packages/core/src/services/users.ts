// Users service (docs/06-security.md §2, F1.*). Owner: Lane B (T-101/T-102 extend it).
// Services return already-masked DTOs shaped by @relay/contracts; route handlers stay thin.
import type { MeResponse } from '@relay/contracts/api/users';
import { PERMISSION_KEYS } from '@relay/contracts/permissions';
import { AppError } from '../errors';
import type { Actor } from '../auth/actor';

export interface MeProfile {
  user: Omit<MeResponse['user'], 'id' | 'workspaceId' | 'baseLevel' | 'locale'>;
  workspace: MeResponse['workspace'];
  settings: Record<string, unknown>;
}

/** `ff_*` booleans of workspaces.settings (10 §2). */
export function flagsOf(settings: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(settings))
    if (k.startsWith('ff_') && typeof v === 'boolean') out[k] = v;
  return out;
}

/** Pure shaping of GET /api/v1/me from the actor + its loaded profile. */
export function toMeResponse(actor: Actor, profile: MeProfile): MeResponse {
  return {
    user: {
      id: actor.userId,
      workspaceId: actor.workspaceId,
      baseLevel: actor.baseLevel,
      locale: actor.locale,
      ...profile.user,
    },
    workspace: profile.workspace,
    permissions: actor.baseLevel === 'owner' ? [...PERMISSION_KEYS] : [...actor.permissions].sort(),
    flags: flagsOf(profile.settings),
  };
}

/** GET /api/v1/me. T-101 loads the profile from the DB. */
export async function me(_actor: Actor): Promise<MeResponse> {
  throw new AppError('UNAUTHENTICATED'); // replaced in T-101 (no sessions exist yet)
}

export const usersService = { me, toMeResponse };
