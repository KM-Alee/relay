// CRM settings: fields. Needs crm.config.manage; the API enforces it again.
import { SettingsFields } from '@/components/crm/settings-fields';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePermission('crm.config.manage');
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <SettingsFields />
    </main>
  );
}
