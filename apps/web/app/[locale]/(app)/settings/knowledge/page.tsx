// Knowledge base editor (T-208, F6.5). Needs ai.manage.
import { KnowledgeEditor } from '@/components/ai/knowledge-editor';
import { requirePermission } from '@/lib/http/page-auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePermission('ai.manage');
  return <KnowledgeEditor />;
}
