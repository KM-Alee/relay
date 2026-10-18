// Permission KEYS (docs/06-security.md §2). Browser-safe (nav.ts, MeResponse). Level defaults and
// enforcement live in @relay/core/auth/permissions. Shared file: additions are rare, additive only.
import { z } from 'zod';

export const PERMISSION_KEYS = [
  'crm.contact.view',
  'crm.contact.create',
  'crm.contact.edit',
  'crm.contact.delete',
  'crm.company.view',
  'crm.company.create',
  'crm.company.edit',
  'crm.company.delete',
  'crm.opportunity.view',
  'crm.opportunity.create',
  'crm.opportunity.edit',
  'crm.opportunity.delete',
  'crm.opportunity.value.view',
  'crm.export',
  'crm.import',
  'crm.tags.manage',
  'crm.config.manage',
  'leads.view_all',
  'leads.create',
  'leads.reassign',
  'leads.recovery.view',
  'team.availability.view',
  'team.availability.manage',
  'routing.manage',
  'messaging.send',
  'payments.request',
  'appointments.manage',
  'appointments.override',
  'integrations.manage',
  'integrations.view',
  'audit.view',
  'ai.manage',
  'ai.use',
  'dashboard.company',
  'users.invite',
  'users.manage',
  'roles.manage',
  'workspace.settings',
  'demo.judge_console',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const permissionKeySchema = z.enum(PERMISSION_KEYS);

const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);
export const isPermissionKey = (k: string): k is PermissionKey => KEY_SET.has(k);
