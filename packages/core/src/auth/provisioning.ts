// Workspace provisioning at signup (F1.1, docs/06-security.md §1): everything a new workspace needs,
// created in the SAME transaction as the workspace + Owner. Owner: Lane B.
//
// Each provisioner gets the signup tx (workspace context already set) and must be idempotent-safe for
// a brand-new workspace. Lanes add ONE entry here for their domain's defaults (shared file, additive):
//   - Lane A (T-120/T-124): default team (Owner as manager + member) + default escalation policy
//     (next_eligible → next_eligible → team_backup → team_manager, 02 §2) + lead sources.
//   - Lane B (T-111): default pipeline + stages.
//   - Lane C (T-208): default message templates (en/ur).
import type { Tx } from '@relay/db';
import { LEVEL_DEFAULTS, MANAGER_ROLE } from '@relay/contracts/permission-defaults';
import { uuidv7 } from '../ids';
import * as repo from '../repos/identity';
import { createPipelineIn } from '../services/crm-pipelines';

export interface ProvisionContext {
  workspaceId: string;
  ownerUserId: string;
  locale: 'en' | 'ur';
}

export interface WorkspaceProvisioner {
  name: string;
  run: (tx: Tx, ctx: ProvisionContext) => Promise<void>;
}

/** Level defaults (admin, user; Owner is implicit) + the seeded, editable "Manager" role (F1.7). */
export const identityProvisioner: WorkspaceProvisioner = {
  name: 'identity',
  run: async (tx, ctx) => {
    await repo.upsertLevelPermissions(tx, ctx.workspaceId, 'admin', LEVEL_DEFAULTS.admin);
    await repo.upsertLevelPermissions(tx, ctx.workspaceId, 'user', LEVEL_DEFAULTS.user);
    await repo.insertRole(tx, {
      id: uuidv7(),
      workspaceId: ctx.workspaceId,
      key: MANAGER_ROLE.key,
      name: MANAGER_ROLE.name,
      permissions: MANAGER_ROLE.permissions,
    });
  },
};

/** Default sales pipeline (New → Qualified → Proposal → Won / Lost) so a new workspace can use the board at once (T-111). */
export const pipelinesProvisioner: WorkspaceProvisioner = {
  name: 'pipelines',
  run: async (tx, ctx) => {
    await createPipelineIn(tx, ctx.workspaceId, { name: 'Sales', isDefault: true });
  },
};

export const workspaceProvisioners: WorkspaceProvisioner[] = [
  identityProvisioner,
  pipelinesProvisioner,
  // TODO(Lane A, T-120/T-124): teamsProvisioner (default team + escalation policy + lead sources)
  // TODO(Lane C, T-208): templatesProvisioner (default en/ur message templates)
];

export async function provisionWorkspace(
  tx: Tx,
  ctx: ProvisionContext,
  provisioners: readonly WorkspaceProvisioner[] = workspaceProvisioners,
): Promise<void> {
  for (const p of provisioners) await p.run(tx, ctx);
}
