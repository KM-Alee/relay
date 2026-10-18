'use client';
// Voice-note transcript block for an inbound audio bubble (T-217, F8.1/F8.3): "AI transcript" label, one-line
// summary, failure state with Retry. Self-contained: the thread mounts <Transcript m={m} /> under the audio player.
import type { MessageDto } from '@relay/contracts/api/messaging';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AIBadge } from '@/components/relay/ai-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';

export function Transcript({ m, onChanged }: { m: MessageDto; onChanged?: () => void }) {
  const t = useTranslations('ai.voice');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  if (m.kind !== 'audio' || m.direction !== 'in') return null;
  const status = m.transcriptStatus ?? 'none';
  if (status === 'none') return null;

  async function retry() {
    setRetrying(true);
    setRetryError(false);
    try {
      await api.ai.transcribeRetry(m.id);
      onChanged?.();
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(false);
    }
  }

  if (status === 'pending') {
    return (
      <p role="status" className="mt-1 flex items-center gap-2 text-meta text-fg-2">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        {t('pending')}
      </p>
    );
  }
  if (status === 'failed') {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-fg-2">
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
        <span>{t('failed')}</span>
        <Button size="sm" variant="secondary" loading={retrying} onClick={retry}>
          {t('retry')}
        </Button>
        {retryError ? <span role="alert">{t('failed')}</span> : null}
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-control bg-ai-surface p-2.5">
      <AIBadge className="self-start">{t('label')}</AIBadge>
      {m.summary ? (
        <p dir="auto" className="text-meta font-medium text-fg">
          <span className="text-fg-2">{t('summary')}: </span>
          {m.summary}
        </p>
      ) : null}
      {m.transcript ? (
        <p dir="auto" className="whitespace-pre-wrap break-words text-body text-fg">
          {m.transcript}
        </p>
      ) : null}
    </div>
  );
}
