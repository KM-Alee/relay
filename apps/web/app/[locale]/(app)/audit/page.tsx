// Audit log viewer (T-151, T-220; F4.2, F4.3, F4.4). Gate: nav.ts (audit.view). Read-only by construction.
import { requirePage } from '@/lib/http/page-auth';
import { AuditView } from './audit-view';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePage('audit');
  return <AuditView />;
}
