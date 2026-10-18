// Lane A provisioner (T-120/T-124): default team + escalation policy + lead sources + public form.
// Runs in the signup tx (workspace context set). Defaults: docs/03-lead-engine.md §3.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '../ids';
import * as teamsRepo from '../repos/teams';
import type { ProvisionContext, WorkspaceProvisioner } from './provisioning';

/** L1 next → L2 next → L3 team backup → L4 team manager, repeat 1 (03 §3). */
export const DEFAULT_LEVELS = [
  { position: 1, targetType: 'next_eligible', timeoutSeconds: 120 },
  { position: 2, targetType: 'next_eligible', timeoutSeconds: 120 },
  { position: 3, targetType: 'team_backup', timeoutSeconds: 90 },
  { position: 4, targetType: 'team_manager', timeoutSeconds: 90 },
] as const;

export const DEFAULT_MANUAL_SOURCES = [
  { key: 'walk_in', label: 'Walk-in' },
  { key: 'phone_call', label: 'Phone call' },
  { key: 'referral', label: 'Referral' },
] as const;

/** Public form slug from the workspace slug (web_forms_slug_shape). */
export function formSlugFor(workspaceSlug: string): string {
  const s = workspaceSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return s.length >= 3 ? s : `form-${s}${uuidv7().slice(-6)}`;
}

export async function provisionTeams(tx: Tx, ctx: ProvisionContext): Promise<{ teamId: string }> {
  const policyId = uuidv7();
  await teamsRepo.insertPolicy(tx, {
    id: policyId,
    workspaceId: ctx.workspaceId,
    name: ctx.locale === 'ur' ? 'ڈیفالٹ' : 'Default',
    levels: DEFAULT_LEVELS.map((l) => ({ ...l, id: uuidv7() })),
  });
  const teamId = uuidv7();
  await teamsRepo.insertTeam(tx, {
    id: teamId,
    workspaceId: ctx.workspaceId,
    name: ctx.locale === 'ur' ? 'سیلز' : 'Sales',
    isDefault: true,
    managerUserId: ctx.ownerUserId,
    backupUserId: ctx.ownerUserId,
    escalationPolicyId: policyId,
  });
  await teamsRepo.addMember(tx, { workspaceId: ctx.workspaceId, teamId, userId: ctx.ownerUserId });
  await teamsRepo.insertLeadSources(tx, [
    ...DEFAULT_MANUAL_SOURCES.map((s) => ({
      id: uuidv7(),
      workspaceId: ctx.workspaceId,
      kind: 'manual' as const,
      ...s,
    })),
    {
      id: uuidv7(),
      workspaceId: ctx.workspaceId,
      key: 'web_form',
      label: 'Web form',
      kind: 'web_form' as const,
    },
    {
      id: uuidv7(),
      workspaceId: ctx.workspaceId,
      key: 'whatsapp',
      label: 'WhatsApp',
      kind: 'whatsapp' as const,
    },
  ]);
  const ws = await tx.execute<{ slug: string; name: string }>(
    sql`select slug, name from workspaces where id = ${ctx.workspaceId}`,
  );
  const w = ws.rows[0];
  if (w) {
    await teamsRepo.insertWebForm(tx, {
      id: uuidv7(),
      workspaceId: ctx.workspaceId,
      slug: formSlugFor(w.slug),
      title: w.name,
      teamId,
    });
  }
  return { teamId };
}

export const teamsProvisioner: WorkspaceProvisioner = {
  name: 'teams',
  run: async (tx, ctx) => {
    await provisionTeams(tx, ctx);
  },
};
