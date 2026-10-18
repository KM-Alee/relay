// Leads list (T-122/T-123; F3.1, F3.4). Gate: nav.ts; the API re-checks scope (06 §2). Owner: Lane A.
// Overview drill-downs land here with ?state=pending | ?created=today | ?escalated=today|24h (F5.3).
import { can } from '@relay/core/auth/permissions';
import { LeadsView, type LeadsDrill } from '@/components/leads/leads-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePage('leads');
  const sp = await searchParams;
  const drill: LeadsDrill = {};
  if (sp.state === 'pending') drill.state = 'pending';
  if (sp.created === 'today') drill.created = 'today';
  if (sp.escalated === 'today' || sp.escalated === '24h') drill.escalated = sp.escalated;
  return (
    <LeadsView
      canViewAll={can(actor, 'leads.view_all')}
      canCreate={can(actor, 'leads.create')}
      drill={drill}
    />
  );
}
