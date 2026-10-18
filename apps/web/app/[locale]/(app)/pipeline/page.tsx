// Pipeline board + table (T-111, F2.5).
import { PipelineView } from '@/components/crm/pipeline-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('pipeline');
  return (
    <main className="mx-auto max-w-[96rem] px-4 py-6">
      <PipelineView />
    </main>
  );
}
