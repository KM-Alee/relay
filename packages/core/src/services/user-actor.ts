// Actor for a user without a browser session (Slack button, public instant booking). Owner: Lane C.
// The caller has already authenticated the request by other means (signed Slack payload, signed booking token).
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor, BaseLevel } from '../auth/actor';
import { loadEffectivePermissions } from '../auth/effective-permissions';

export async function actorForUser(workspaceId: string, userId: string): Promise<Actor | null> {
  return withWorkspaceTx(workspaceId, async (tx) => {
    const u = (
      await tx.execute<{ base_level: BaseLevel; locale: string }>(
        sql`select base_level, locale from users where id = ${userId} and is_active`,
      )
    ).rows[0];
    if (!u) return null;
    return {
      userId,
      workspaceId,
      sessionId: '',
      baseLevel: u.base_level,
      permissions: await loadEffectivePermissions(tx, workspaceId, userId, u.base_level),
      locale: u.locale === 'ur' ? 'ur' : 'en',
    } satisfies Actor;
  });
}
