// STUB (W0/T-013). Owner: Lane D (T-012): every shared component in en/ur × light/dark.
import { notFound } from 'next/navigation';
import { ComingSoon } from '@/components/relay/coming-soon';
import { devToolsEnabled } from '@/lib/dev/guard';

export default function KitchenSinkPage() {
  if (!devToolsEnabled()) notFound();
  return <ComingSoon screen="nav.devKitchenSink" />;
}
