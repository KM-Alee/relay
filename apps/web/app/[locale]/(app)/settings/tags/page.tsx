// CRM settings: tags. Needs crm.tags.manage; the API enforces it again.
import { SettingsTags } from '@/components/crm/settings-tags';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePermission('crm.tags.manage');
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <SettingsTags />
    </main>
  );
}
