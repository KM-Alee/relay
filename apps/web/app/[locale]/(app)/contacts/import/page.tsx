// CSV contact import (T-226, F2.12). Needs crm.import; the API re-checks it and crm.contact.create.
import { ImportWizard } from '@/components/crm/import-wizard';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePermission('crm.import');
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <ImportWizard />
    </main>
  );
}
