// CRM settings: pipelines. Needs crm.config.manage; the API enforces it again.
import { SettingsPipelines } from '@/components/crm/settings-pipelines';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePermission('crm.config.manage');
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <SettingsPipelines />
    </main>
  );
}
