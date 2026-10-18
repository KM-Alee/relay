// Localized message templates editor (T-208). Needs ai.manage.
import { TemplatesEditor } from '@/components/ai/templates-editor';
import { requirePermission } from '@/lib/http/page-auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('ai.manage');
  return <TemplatesEditor />;
}
