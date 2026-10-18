// AI settings (T-208, F6.1): stand-in mode, triage/voice toggles, daily cost cap. Needs ai.manage.
import { AiSettingsForm } from '@/components/ai/ai-settings-form';
import { requirePermission } from '@/lib/http/page-auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('ai.manage');
  return <AiSettingsForm />;
}
