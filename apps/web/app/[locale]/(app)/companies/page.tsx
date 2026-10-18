// Companies (T-110, F2.1).
import { CompaniesView } from '@/components/crm/companies-view';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePermission('crm.company.view');
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <CompaniesView />
    </main>
  );
}
