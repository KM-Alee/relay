import { moneySchema } from '@relay/contracts/money';
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { computeEffectivePermissions } from './effective-permissions';
import { maskMoney, maskMoneyFigure, maskOpportunity, maskValueFields } from './mask';
import { MANAGER_ROLE } from './permissions';
import { visibleLeadScope } from './visibility';

const actor = (baseLevel: Actor['baseLevel'], perms: string[] = []): Actor => ({
  userId: 'u1',
  workspaceId: 'w1',
  sessionId: 's',
  baseLevel,
  permissions: new Set(perms) as Actor['permissions'],
  locale: 'en',
});
const user = actor('user');
const manager = actor('user', ['crm.opportunity.value.view', 'leads.view_all']);

describe('[F1.4] value masking (core/auth/mask.ts)', () => {
  it('[F1.4] opportunity serializer nulls the value without the permission', () => {
    const o = { id: 'o1', title: 'Roof', valueMinor: 250_000_00n };
    expect(maskOpportunity(user, o)).toEqual({
      id: 'o1',
      title: 'Roof',
      valueMinor: null,
      valueMasked: true,
    });
    expect(maskOpportunity(manager, o)).toMatchObject({ valueMinor: 250_000_00n, valueMasked: false });
    expect(maskOpportunity(actor('owner'), o).valueMasked).toBe(false);
  });

  it('[F1.4] dashboard figures, wire money, nested AI/audit/CSV objects are masked', () => {
    expect(maskMoneyFigure(user, 5n)).toEqual({ value: null, masked: true });
    expect(maskMoneyFigure(manager, 5n)).toEqual({ value: 5, masked: false });
    expect(moneySchema.parse(maskMoney(user, 100, 'PKR'))).toEqual({ masked: true });
    expect(maskMoney(manager, 100, 'PKR')).toEqual({ masked: false, amountMinor: 100, currency: 'PKR' });
    expect(
      maskValueFields(user, { after: { valueMinor: 9, stage: 'Won' }, rows: [{ amount_minor: 1 }] }),
    ).toEqual({
      after: { valueMinor: '[masked]', stage: 'Won' },
      rows: [{ amount_minor: '[masked]' }],
    });
  });
});

describe('[F1.3][F1.7] effective permissions', () => {
  it('[F1.3] level defaults ∪ roles, overrides: grant adds, deny wins; owner = everything', () => {
    const eff = computeEffectivePermissions({
      baseLevel: 'user',
      levelPermissions: null,
      rolePermissions: [MANAGER_ROLE.permissions],
      overrides: [
        { permission: 'crm.export', effect: 'grant' },
        { permission: 'leads.reassign', effect: 'deny' },
        { permission: 'leads.reassign', effect: 'grant' },
        { permission: 'not.a.key', effect: 'grant' },
      ],
    });
    expect(eff.has('leads.create')).toBe(true); // user default
    expect(eff.has('leads.view_all')).toBe(true); // Manager role
    expect(eff.has('crm.export')).toBe(true); // grant
    expect(eff.has('leads.reassign')).toBe(false); // deny wins
    expect([...eff]).not.toContain('not.a.key');
    const owner = computeEffectivePermissions({
      baseLevel: 'owner',
      levelPermissions: [],
      rolePermissions: [],
      overrides: [{ permission: 'audit.view', effect: 'deny' }],
    });
    expect(owner.has('audit.view')).toBe(true);
  });

  it('[F1.3] a customized level row replaces the code default', () => {
    const eff = computeEffectivePermissions({
      baseLevel: 'user',
      levelPermissions: ['crm.contact.view'],
      rolePermissions: [],
      overrides: [],
    });
    expect([...eff]).toEqual(['crm.contact.view']);
  });

  it('[Q2] lead scope: own only without leads.view_all', () => {
    expect(visibleLeadScope(user)).toEqual({ all: false, ownerUserId: 'u1' });
    expect(visibleLeadScope(manager)).toEqual({ all: true });
  });
});
