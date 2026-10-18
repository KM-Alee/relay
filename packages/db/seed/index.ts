// Composed seed (13 §3): ONE import + ONE list entry per domain module, in dependency order.
import { aiSeed } from './ai';
import { crmSeed } from './crm';
import { identitySeed } from './identity';
import { leadsSeed } from './leads';
import { messagingSeed } from './messaging';
import { teamsSeed } from './teams';
import type { SeedContext, SeedModule } from './types';

export const seedModules: readonly SeedModule[] = [
  identitySeed, // B: workspaces, users per role, sessions-free logins
  teamsSeed, // A: teams, members, availability
  crmSeed, // B: pipelines, contacts, companies, opportunities
  leadsSeed, // A: leads in every state
  messagingSeed, // C: conversations, messages, templates
  aiSeed, // C2b: KB, localized templates, AI settings
];

export async function runSeeds(ctx: SeedContext, modules = seedModules): Promise<void> {
  for (const m of modules) {
    ctx.log(`seed: ${m.name}`);
    await m.run(ctx);
  }
}

export type { SeedContext, SeedModule } from './types';
export { SEED_USERS, SEED_WORKSPACES, DEV_PASSWORD } from './identity';
export { createUser, createWorkspace, DEV_PASSWORD_HASH } from './factories';
