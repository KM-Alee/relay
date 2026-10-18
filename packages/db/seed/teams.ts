// Seed: teams demo data (T-120). Owner: Lane A (framework: Lane B, T-010). Idempotent (fixed ids).
// Per seeded workspace: default policy (03 §3), one default team, members, manual lead sources and a
// public web form at /f/<workspace-slug>.
import {
  escalationLevels,
  escalationPolicies,
  leadSources,
  teamMembers,
  teams,
  webForms,
} from '../src/schema/index';
import { SEED_USERS, SEED_WORKSPACES } from './identity';
import type { SeedModule } from './types';

const id = (ws: number, kind: number, n = 0) =>
  `0192f3a0-0000-7000-8${ws}${kind.toString(16).padStart(2, '0')}-${n.toString(16).padStart(12, '0')}`;

const LEVELS = [
  { position: 1, targetType: 'next_eligible', timeoutSeconds: 120 },
  { position: 2, targetType: 'next_eligible', timeoutSeconds: 120 },
  { position: 3, targetType: 'team_backup', timeoutSeconds: 90 },
  { position: 4, targetType: 'team_manager', timeoutSeconds: 90 },
] as const;

const SOURCES = [
  { key: 'walk_in', label: 'Walk-in', kind: 'manual' },
  { key: 'phone_call', label: 'Phone call', kind: 'manual' },
  { key: 'referral', label: 'Referral', kind: 'manual' },
  { key: 'web_form', label: 'Web form', kind: 'web_form' },
  { key: 'whatsapp', label: 'WhatsApp', kind: 'whatsapp' },
] as const;

export const teamsSeed: SeedModule = {
  name: 'teams',
  run: async ({ db, log }) => {
    for (const [wi, w] of SEED_WORKSPACES.entries()) {
      const people = SEED_USERS.filter((u) => u.ws === wi);
      const ownerUser = people.find((u) => u.baseLevel === 'owner')!;
      const manager = people.find((u) => (u.roles as readonly string[]).includes('manager')) ?? ownerUser;
      const backup = people.find((u) => u.baseLevel === 'admin') ?? ownerUser;
      const handlers = people.filter((u) => u.baseLevel === 'user');
      const policyId = id(wi, 1);
      const teamId = id(wi, 2);
      await db
        .insert(escalationPolicies)
        .values({ id: policyId, workspaceId: w.id, name: 'Default' })
        .onConflictDoNothing();
      await db
        .insert(escalationLevels)
        .values(LEVELS.map((l) => ({ ...l, id: id(wi, 3, l.position), workspaceId: w.id, policyId })))
        .onConflictDoNothing();
      await db
        .insert(teams)
        .values({
          id: teamId,
          workspaceId: w.id,
          name: 'Sales',
          isDefault: true,
          managerUserId: manager.id,
          backupUserId: backup.id,
          escalationPolicyId: policyId,
        })
        .onConflictDoNothing();
      await db
        .insert(teamMembers)
        .values(handlers.map((u, i) => ({ workspaceId: w.id, teamId, userId: u.id, position: i + 1 })))
        .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] });
      await db
        .insert(leadSources)
        .values(SOURCES.map((s, i) => ({ ...s, id: id(wi, 4, i + 1), workspaceId: w.id })))
        .onConflictDoNothing();
      await db
        .insert(webForms)
        .values({ id: id(wi, 5), workspaceId: w.id, slug: w.slug, title: w.name, teamId })
        .onConflictDoNothing();
      log(`  ${w.slug}: team Sales (${handlers.length} handlers), form /f/${w.slug}`);
    }
  },
};
