// Public landing page after hosted Stripe Checkout (success/cancel URLs, 04 §4). No login, no data: the real
// state change comes from the signed webhook, never from this redirect (I2.2/I2.3).
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ result: string }> }) {
  const { result } = await params;
  if (result !== 'success' && result !== 'cancelled') notFound();
  const t = await getTranslations('payments');
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="mb-2 text-2xl font-semibold">{t(`pay.${result}.title`)}</h1>
      <p className="opacity-80">{t(`pay.${result}.body`)}</p>
    </main>
  );
}
