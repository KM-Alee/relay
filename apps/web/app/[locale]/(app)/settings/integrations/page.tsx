// STUB (W0/T-013). Owner: Lane C (T-140) replaces this page. Gate + route map: docs/07-frontend-i18n.md §1.
import { ComingSoon } from '@/components/relay/coming-soon';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('integrations'); // T-102: server-side gate (permission from nav.ts)
  return <ComingSoon screen="nav.integrations" />;
}
