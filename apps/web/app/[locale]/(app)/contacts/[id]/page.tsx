// Contact 360 (T-117, F2.8). Out-of-scope ids render the API's 404 as a not-found state.
import { ContactDetail } from '@/components/crm/contact-detail';
import { requirePermission } from '@/lib/http/page-auth';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('crm.contact.view');
  const { id } = await params;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <ContactDetail id={id} />
    </main>
  );
}
