// Leads list (T-122/T-123; F3.1, F3.4). Gate: nav.ts; the API re-checks scope (06 §2). Owner: Lane A.
import { can } from '@relay/core/auth/permissions';
import { LeadsView } from '@/components/leads/leads-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  const actor = await requirePage('leads');
  return <LeadsView canViewAll={can(actor, 'leads.view_all')} canCreate={can(actor, 'leads.create')} />;
}
