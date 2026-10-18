// Judge Console (T-209, F10.1). Gate: demo.judge_console (nav.ts) AND DEMO_MODE; invisible (404) otherwise.
import { config } from '@relay/core/config';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/http/page-auth';
import { JudgeView } from './judge-view';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePage('judge');
  if (!config.core.DEMO_MODE) notFound();
  return <JudgeView />;
}
