// Recovery queue (T-129; F3.7, 03 §7). Gate: nav.ts (leads.recovery.view); the API re-checks. Owner: Lane A.
// ?reason=overdue|escalated2|idle|awaiting|critical filters (each criterion independently testable).
import { recoveryReasonSchema } from '@relay/contracts/api/leads';
import { RecoveryView } from '@/components/leads/recovery-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage('recovery');
  const sp = await searchParams;
  const reason = recoveryReasonSchema.safeParse(sp.reason);
  return <RecoveryView initialReason={reason.success ? reason.data : null} initialMine={sp.mine === '1'} />;
}
