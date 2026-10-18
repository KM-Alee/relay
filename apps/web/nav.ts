// Navigation config (docs/07-frontend-i18n.md §1, docs/design/screens.md §1). Owner: Lane D.
// Lanes replace their STUB PAGE, never this file (13 §3). Entries the user lacks `perm` for are
// omitted by the shell (convenience only: pages and APIs enforce permissions server-side, F1.5).
import type { PermissionKey } from '@relay/contracts/permissions';

export type NavGroup = 'primary' | 'more' | 'hidden';

export interface NavItem {
  id: string;
  /** Locale-less path; render with `Link` from `@/lib/i18n/navigation`. */
  href: `/${string}`;
  /** Key in the `common` namespace. */
  labelKey: `nav.${string}`;
  /** Icon name (lucide-react, added by T-012). */
  icon: string;
  /** Required permission; null = any signed-in user (record scope still applies). */
  perm: PermissionKey | null;
  group: NavGroup;
  /** Only shown when the workspace is in demo mode. */
  demoOnly?: boolean;
  /** Lane that owns the page (13 §2). */
  lane: 'A' | 'B' | 'C' | 'D' | 'Q';
}

export const NAV: readonly NavItem[] = [
  // Primary (top nav, in order)
  {
    id: 'overview',
    href: '/',
    labelKey: 'nav.overview',
    icon: 'layout-dashboard',
    perm: null,
    group: 'primary',
    lane: 'D',
  },
  {
    id: 'leads',
    href: '/leads',
    labelKey: 'nav.leads',
    icon: 'inbox-arrow',
    perm: null,
    group: 'primary',
    lane: 'A',
  },
  {
    id: 'inbox',
    href: '/inbox',
    labelKey: 'nav.inbox',
    icon: 'message-circle',
    perm: null,
    group: 'primary',
    lane: 'C',
  },
  {
    id: 'pipeline',
    href: '/pipeline',
    labelKey: 'nav.pipeline',
    icon: 'kanban',
    perm: 'crm.opportunity.view',
    group: 'primary',
    lane: 'B',
  },
  {
    id: 'recovery',
    href: '/recovery',
    labelKey: 'nav.recovery',
    icon: 'life-buoy',
    perm: 'leads.recovery.view',
    group: 'primary',
    lane: 'A',
  },
  {
    id: 'automations',
    href: '/automations',
    labelKey: 'nav.automations',
    icon: 'workflow',
    perm: 'routing.manage',
    group: 'primary',
    lane: 'A',
  },
  // More ▾
  {
    id: 'appointments',
    href: '/appointments',
    labelKey: 'nav.appointments',
    icon: 'calendar',
    perm: 'appointments.manage',
    group: 'more',
    lane: 'C',
  },
  {
    id: 'payments',
    href: '/payments',
    labelKey: 'nav.payments',
    icon: 'credit-card',
    perm: 'payments.request',
    group: 'more',
    lane: 'C',
  },
  {
    id: 'team',
    href: '/team',
    labelKey: 'nav.team',
    icon: 'users',
    perm: 'users.manage',
    group: 'more',
    lane: 'B',
  },
  {
    id: 'integrations',
    href: '/settings/integrations',
    labelKey: 'nav.integrations',
    icon: 'plug',
    perm: 'integrations.view',
    group: 'more',
    lane: 'C',
  },
  {
    id: 'audit',
    href: '/audit',
    labelKey: 'nav.audit',
    icon: 'scroll-text',
    perm: 'audit.view',
    group: 'more',
    lane: 'B',
  },
  {
    id: 'settings',
    href: '/settings',
    labelKey: 'nav.settings',
    icon: 'settings',
    perm: 'workspace.settings',
    group: 'more',
    lane: 'B',
  },
  {
    id: 'judge',
    href: '/judge',
    labelKey: 'nav.judge',
    icon: 'gavel',
    perm: 'demo.judge_console',
    group: 'more',
    demoOnly: true,
    lane: 'B',
  },
  // Reachable, not in the menu
  {
    id: 'contacts',
    href: '/contacts',
    labelKey: 'nav.contacts',
    icon: 'contact',
    perm: 'crm.contact.view',
    group: 'hidden',
    lane: 'B',
  },
  { id: 'me', href: '/me', labelKey: 'nav.me', icon: 'user', perm: null, group: 'hidden', lane: 'B' },
  {
    id: 'traceability',
    href: '/traceability',
    labelKey: 'nav.traceability',
    icon: 'list-checks',
    perm: 'demo.judge_console',
    group: 'hidden',
    demoOnly: true,
    lane: 'Q',
  },
];

/** Items visible to someone holding `perms` (pass `isOwner` for the implicit-all rule). */
export function visibleNav(
  perms: ReadonlySet<PermissionKey>,
  opts: { isOwner?: boolean; demoMode?: boolean } = {},
): NavItem[] {
  return NAV.filter(
    (i) => (opts.isOwner || i.perm === null || perms.has(i.perm)) && (!i.demoOnly || opts.demoMode),
  );
}
