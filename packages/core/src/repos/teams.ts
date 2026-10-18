// Teams / routing configuration repo (docs/02-data-model.md §2). Owner: Lane A.
import type { Tx } from '@relay/db';
import {
  escalationLevels,
  escalationPolicies,
  leadSources,
  teamMembers,
  teams,
  users,
  webForms,
  workspaces,
} from '@relay/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { EscalationPolicy, LevelTargetType, Person, TeamConfig } from '../domain/leads';

export type TeamRow = typeof teams.$inferSelect;

export interface WorkspaceRouting {
  id: string;
  ownerUserId: string;
  timeWarpMultiplier: string;
  settings: Record<string, unknown>;
}

export async function workspaceRouting(tx: Tx, workspaceId: string): Promise<WorkspaceRouting | null> {
  const rows = await tx
    .select({
      id: workspaces.id,
      ownerUserId: workspaces.ownerUserId,
      timeWarpMultiplier: workspaces.timeWarpMultiplier,
      settings: workspaces.settings,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const r = rows[0];
  if (!r || !r.ownerUserId) return null;
  return {
    id: r.id,
    ownerUserId: r.ownerUserId,
    timeWarpMultiplier: String(r.timeWarpMultiplier),
    settings: (r.settings ?? {}) as Record<string, unknown>,
  };
}

export const toTeamConfig = (t: TeamRow): TeamConfig => ({
  id: t.id,
  managerUserId: t.managerUserId,
  backupUserId: t.backupUserId,
  routingMode: t.routingMode,
  rrCursor: t.rrCursor,
  defaultCapacity: t.defaultCapacity,
  skillsRouting: t.skillsRouting,
  ackWindowSeconds: t.ackWindowSeconds,
  urgentAckWindowSeconds: t.urgentAckWindowSeconds,
  routingRetrySeconds: t.routingRetrySeconds,
  idleSeconds: t.idleSeconds,
  idleRetriggerEnabled: t.idleRetriggerEnabled,
});

/** Team row; `lock` serializes capacity + rr_cursor decisions for the team (03 §5, T8). */
export async function getTeam(tx: Tx, teamId: string, lock = false): Promise<TeamRow | null> {
  const q = tx.select().from(teams).where(eq(teams.id, teamId));
  const rows = lock ? await q.for('update') : await q;
  return rows[0] ?? null;
}

export async function defaultTeam(tx: Tx): Promise<TeamRow | null> {
  const rows = await tx.select().from(teams).where(eq(teams.isDefault, true)).limit(1);
  return rows[0] ?? null;
}

export async function listTeams(tx: Tx): Promise<TeamRow[]> {
  return tx.select().from(teams).orderBy(asc(teams.createdAt));
}

export async function setRrCursor(tx: Tx, teamId: string, cursor: number): Promise<void> {
  await tx.update(teams).set({ rrCursor: cursor }).where(eq(teams.id, teamId));
}

export async function loadPolicy(tx: Tx, policyId: string): Promise<EscalationPolicy> {
  const p = (await tx.select().from(escalationPolicies).where(eq(escalationPolicies.id, policyId)))[0];
  const levels = await tx
    .select()
    .from(escalationLevels)
    .where(eq(escalationLevels.policyId, policyId))
    .orderBy(asc(escalationLevels.position));
  return {
    id: policyId,
    repeatCount: p?.repeatCount ?? 1,
    levels: levels.map((l) => ({
      position: l.position,
      targetType: l.targetType,
      targetUserId: l.targetUserId,
      timeoutSeconds: l.timeoutSeconds,
    })),
  };
}

/**
 * Every person the engine may consider for this team: members (with position) plus the designated
 * users (manager, backup, level targets, workspace Owner, extras), with open HANDLER lead counts (03 §1).
 */
export async function loadPeople(
  tx: Tx,
  teamId: string,
  designated: readonly (string | null | undefined)[],
): Promise<Person[]> {
  const memberRows = await tx
    .select({ userId: teamMembers.userId, position: teamMembers.position })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  const pos = new Map(memberRows.map((m) => [m.userId, m.position]));
  const ids = [...new Set([...pos.keys(), ...designated.filter((d): d is string => !!d)])];
  if (!ids.length) return [];
  const rows = await tx
    .select({
      id: users.id,
      name: users.name,
      isActive: users.isActive,
      availability: users.availability,
      capacity: users.capacity,
      skills: users.skills,
      open: sql<number>`(select count(*)::int from leads l where l.owner_user_id = ${users.id}
                           and l.custody = 'handler' and l.status = 'open')`,
    })
    .from(users)
    .where(inArray(users.id, ids));
  return rows.map((u) => ({
    userId: u.id,
    name: u.name,
    isActive: u.isActive,
    availability: u.availability,
    openHandlerCount: Number(u.open),
    capacity: u.capacity,
    skills: u.skills,
    position: pos.get(u.id) ?? null,
  }));
}

export async function teamIdsOfUser(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}

export async function membersOf(tx: Tx, teamIds: readonly string[]) {
  if (!teamIds.length) return [];
  return tx
    .select({
      teamId: teamMembers.teamId,
      position: teamMembers.position,
      userId: users.id,
      name: users.name,
      availability: users.availability,
      isActive: users.isActive,
      capacity: users.capacity,
      version: users.version,
      open: sql<number>`(select count(*)::int from leads l where l.owner_user_id = ${users.id}
                           and l.custody = 'handler' and l.status = 'open')`,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(inArray(teamMembers.teamId, [...teamIds]))
    .orderBy(asc(teamMembers.teamId), asc(teamMembers.position));
}

// ── provisioning ────────────────────────────────────────────────────────

export async function insertPolicy(
  tx: Tx,
  p: {
    id: string;
    workspaceId: string;
    name: string;
    levels: { id: string; position: number; targetType: LevelTargetType; timeoutSeconds: number }[];
  },
): Promise<void> {
  await tx.insert(escalationPolicies).values({ id: p.id, workspaceId: p.workspaceId, name: p.name });
  await tx.insert(escalationLevels).values(
    p.levels.map((l) => ({
      id: l.id,
      workspaceId: p.workspaceId,
      policyId: p.id,
      position: l.position,
      targetType: l.targetType,
      timeoutSeconds: l.timeoutSeconds,
    })),
  );
}

export async function insertTeam(tx: Tx, t: typeof teams.$inferInsert): Promise<void> {
  await tx.insert(teams).values(t);
}

export async function addMember(
  tx: Tx,
  m: { workspaceId: string; teamId: string; userId: string },
): Promise<void> {
  await tx.execute(sql`insert into team_members (workspace_id, team_id, user_id, position)
    values (${m.workspaceId}, ${m.teamId}, ${m.userId},
            (select coalesce(max(position), 0) + 1 from team_members where team_id = ${m.teamId}))
    on conflict (team_id, user_id) do nothing`);
}

export async function insertLeadSources(tx: Tx, rows: (typeof leadSources.$inferInsert)[]): Promise<void> {
  if (rows.length) await tx.insert(leadSources).values(rows).onConflictDoNothing();
}

export async function listLeadSources(tx: Tx) {
  return tx.select().from(leadSources).orderBy(asc(leadSources.label));
}

export async function insertWebForm(tx: Tx, f: typeof webForms.$inferInsert): Promise<void> {
  await tx.insert(webForms).values(f).onConflictDoNothing();
}

export async function getWebForm(tx: Tx, id: string) {
  return (
    (
      await tx
        .select()
        .from(webForms)
        .where(and(eq(webForms.id, id), eq(webForms.isActive, true)))
    )[0] ?? null
  );
}

/** SECURITY DEFINER door: public slug → form + workspace (no session). */
export async function lookupWebForm(
  tx: Tx,
  slug: string,
): Promise<{ formId: string; workspaceId: string } | null> {
  const res = await tx.execute<{ form_id: string; workspace_id: string }>(
    sql`select * from relay_web_form_lookup(${slug})`,
  );
  const r = res.rows[0];
  return r ? { formId: r.form_id, workspaceId: r.workspace_id } : null;
}
