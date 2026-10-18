// Contacts list (T-110, F2.1). Replaces the W0 stub. Gate: nav.ts; the API re-checks permission + scope.
import { ContactsView } from '@/components/crm/contacts-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('contacts');
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <ContactsView />
    </main>
  );
}
