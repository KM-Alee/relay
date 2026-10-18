// Kitchen sink (T-012): every shared component in every state, en/ur × light/dark. Dev only (404 otherwise).
import { notFound } from 'next/navigation';
import { devToolsEnabled } from '@/lib/dev/guard';
import { KitchenSink } from './kitchen-sink';

export default function KitchenSinkPage() {
  if (!devToolsEnabled()) notFound();
  return <KitchenSink />;
}
