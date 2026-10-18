'use client';
// AI fields on a contact (T-219, F9.1): value + "AI" badge + timestamp, Refresh, human edit wins (locks).
// Works with AI off: values stay editable and Refresh shows "AI disabled".
import type { AiFieldState } from '@relay/contracts/api/crm-extras';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { AIBadge } from '@/components/relay/ai-badge';
import { StatusBadge } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { fieldClass } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { ErrorNote, useLoad } from './ui';

export function AiFieldsPanel({
  contactId,
  contactVersion,
  canEdit,
  onChanged,
}: {
  contactId: string;
  contactVersion: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('crm.aiFields');
  const locale = useLocale();
  const fmt = useFormatter();
  const reduce = useReducedMotion();
  const list = useLoad(() => api.crm.aiFields.list({ contactId }), `ai:${contactId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<unknown>(null);
  const items = list.data?.items ?? [];
  const aiOn = list.data?.aiEnabled ?? true;
  if (!list.data || !items.length) return <ErrorNote error={list.error} />;

  async function refresh(f: AiFieldState | null, force = false) {
    setBusy(f?.fieldId ?? 'all');
    setError(null);
    try {
      const r = await api.crm.aiFields.fill({ contactId, fieldId: f?.fieldId, force });
      const s = r.results.map((x) => x.status);
      if (!r.aiEnabled) toast.info(t('disabled'));
      else if (s.includes('filled')) toast.success(t('filled'));
      else if (s.every((x) => x === 'locked')) toast.info(t('lockedNote'));
      else toast.info(t('nothingFound'));
      list.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(f: AiFieldState) {
    setBusy(f.fieldId);
    try {
      const v: string | number | null =
        draft === '' ? null : f.outputType === 'number' ? Number(draft) : draft;
      await api.crm.contacts.update(contactId, { version: contactVersion, fields: { [f.fieldId]: v } });
      setEditing(null);
      list.reload();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const label = (f: AiFieldState) => (locale === 'ur' ? f.label.ur : f.label.en);
  const optLabel = (f: AiFieldState, v: string) => {
    const o = f.options.find((x) => x.value === v);
    return o ? (locale === 'ur' ? o.label.ur : o.label.en) : v;
  };

  return (
    <Card aria-labelledby="sec-ai" className="space-y-4">
      <CardHeader
        titleId="sec-ai"
        icon={<Sparkles />}
        title={t('title')}
        description={aiOn ? t('hint') : t('disabled')}
        actions={
          canEdit && (
            <Button size="sm" loading={busy === 'all'} disabled={!aiOn} onClick={() => refresh(null)}>
              <RefreshCw aria-hidden className="size-4" /> {t('refreshAll')}
            </Button>
          )
        }
      />
      <ErrorNote error={error} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((f) => (
          <li key={f.fieldId} className="space-y-2 rounded-control border border-line bg-surface-muted p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-meta font-medium text-fg-2">{label(f)}</span>
              {f.source === 'ai' && <AIBadge />}
              {f.source === 'human' && (
                <StatusBadge tone="neutral" icon={Lock}>
                  {t('locked')}
                </StatusBadge>
              )}
            </div>
            {editing === f.fieldId ? (
              <div className="flex flex-wrap gap-2">
                {f.outputType === 'dropdown' ? (
                  <select
                    className={fieldClass}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label={label(f)}
                  >
                    <option value="" />
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {locale === 'ur' ? o.label.ur : o.label.en}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={fieldClass}
                    type={f.outputType === 'number' ? 'number' : 'text'}
                    value={draft}
                    aria-label={label(f)}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                )}
                <Button size="sm" variant="primary" loading={busy === f.fieldId} onClick={() => saveEdit(f)}>
                  {t('save')}
                </Button>
                <Button size="sm" onClick={() => setEditing(null)}>
                  {t('cancel')}
                </Button>
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={String(f.value) + f.filledAt}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="min-h-7 break-words text-body text-fg"
                >
                  {f.value === null ? (
                    <span className="text-fg-muted">{t('empty')}</span>
                  ) : f.outputType === 'dropdown' ? (
                    optLabel(f, String(f.value))
                  ) : (
                    String(f.value)
                  )}
                </motion.p>
              </AnimatePresence>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-meta text-fg-muted">
                {f.filledAt &&
                  f.source === 'ai' &&
                  t('filledAt', { when: fmt.relativeTime(new Date(f.filledAt)) })}
                {f.filledAt &&
                  f.source === 'human' &&
                  t('editedAt', { when: fmt.relativeTime(new Date(f.filledAt)) })}
              </span>
              {canEdit && editing !== f.fieldId && (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(f.fieldId);
                      setDraft(f.value === null ? '' : String(f.value));
                    }}
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === f.fieldId}
                    disabled={!aiOn}
                    title={aiOn ? undefined : t('disabled')}
                    onClick={() => refresh(f, f.source === 'human' && window.confirm(t('confirmOverwrite')))}
                  >
                    <RefreshCw aria-hidden className="size-4" /> {aiOn ? t('refresh') : t('disabledShort')}
                  </Button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
