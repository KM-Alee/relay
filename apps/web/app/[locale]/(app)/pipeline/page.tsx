// STUB (W0/T-013). Owner: Lane B (T-111) replaces this page. Gate + route map: docs/07-frontend-i18n.md §1.
import { ComingSoon } from '@/components/relay/coming-soon';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('pipeline'); // T-102: server-side gate (permission from nav.ts)
  return <ComingSoon screen="nav.pipeline" />;
}
