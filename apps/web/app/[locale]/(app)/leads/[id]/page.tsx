// Lead detail (T-123; F3.4, F3.11). Out-of-scope ids → 404 from the API. Owner: Lane A.
import { LeadDetailView } from '@/components/leads/lead-detail-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePage('leads');
  const { id } = await params;
  return <LeadDetailView id={id} />;
}
