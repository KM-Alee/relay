// Describe-your-business onboarding / "Set up with AI" (T-218, F9.3). Needs crm.config.manage.
import { OnboardingWizard } from '@/components/crm/onboarding-wizard';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePermission('crm.config.manage');
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <OnboardingWizard />
    </main>
  );
}
