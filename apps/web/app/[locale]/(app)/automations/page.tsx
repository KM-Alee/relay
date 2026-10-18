// Automations (T-124 form, T-202 builder, T-210 time-warp). Owner: Lane A. Gate: routing.manage (nav.ts).
import { AutomationsView } from '@/components/automations/automations-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('automations');
  return <AutomationsView />;
}
