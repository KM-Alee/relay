'use client';
// Lead sources + public web form settings (T-202, F3.1): title, slug, owning team, active, embed snippet.
import type { WebFormDto } from '@relay/contracts/api/automations';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Globe, MessageCircle, PencilLine, RotateCcw, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { FormField } from '@/components/relay/form-field';
import { Ltr } from '@/components/relay/ltr';
import { api } from '@/lib/api-client';
import { NativeSelect, Switch } from './parts';
import { aqk, useErrorToast, useIntake, useTeams } from './use-automations';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;
const KIND_ICON = { web_form: Globe, whatsapp: MessageCircle, manual: PencilLine } as const;

function CopyBox({ label, value }: { label: string; value: string }) {
  const t = useTranslations('automations.intake');
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-medium text-fg">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setDone(true);
              toast.success(t('copied'));
              setTimeout(() => setDone(false), 1800);
            } catch {
              toast.error(t('copyFailed'));
            }
          }}
        >
          {done ? (
            <Check aria-hidden className="size-4 text-success" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {done ? t('copiedShort') : t('copy')}
        </Button>
      </div>
      <pre
        dir="ltr"
        tabIndex={0}
        className="overflow-x-auto rounded-control border border-line bg-surface-muted p-3 text-meta text-fg"
      >
        <code>{value}</code>
      </pre>
    </div>
  );
}

function FormCard({ form }: { form: WebFormDto }) {
  const t = useTranslations('automations.intake');
  const tc = useTranslations('automations.common');
  const qc = useQueryClient();
  const onError = useErrorToast();
  const teams = useTeams();
  const [f, setF] = useState({
    title: form.title,
    slug: form.slug,
    teamId: form.teamId,
    isActive: form.isActive,
  });
  const dirty =
    f.title !== form.title ||
    f.slug !== form.slug ||
    f.teamId !== form.teamId ||
    f.isActive !== form.isActive;
  const slugOk = SLUG_RE.test(f.slug);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const url = `${origin}/f/${form.slug}`;
  const embed = `<iframe src="${url}" title="${form.title.replace(/"/g, '&quot;')}" width="100%" height="640" style="border:0"></iframe>`;

  const save = useMutation({
    mutationFn: () => api.automations.updateWebForm(form.id, { ...f, version: form.version }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: aqk.intake });
      const previous = qc.getQueryData<{ forms: WebFormDto[]; sources: unknown[] }>(aqk.intake);
      if (previous)
        qc.setQueryData(aqk.intake, {
          ...previous,
          forms: previous.forms.map((x) => (x.id === form.id ? { ...x, ...f } : x)),
        });
      return { previous };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.intake, ctx.previous);
      onError(err);
    },
    onSuccess: () => {
      toast.success(t('saved'));
      void qc.invalidateQueries({ queryKey: aqk.intake });
    },
  });

  return (
    <Card className="space-y-5">
      <CardHeader
        icon={<Globe aria-hidden />}
        title={form.title}
        description={
          <span>
            {t('publicUrl')} <Ltr className="text-fg">{`/f/${form.slug}`}</Ltr>
          </span>
        }
        actions={
          <Switch
            checked={f.isActive}
            label={t('active')}
            stateLabel={f.isActive ? t('live') : t('paused')}
            onChange={(v) => setF({ ...f, isActive: v })}
          />
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('formTitle')}>
          {(p) => (
            <Input
              {...p}
              value={f.title}
              maxLength={120}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          )}
        </FormField>
        <FormField label={t('slug')} helper={t('slugHint')} error={!slugOk ? t('slugInvalid') : undefined}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={f.slug}
              maxLength={63}
              onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            />
          )}
        </FormField>
        <FormField label={t('team')} helper={t('teamHint')}>
          {(p) => (
            <NativeSelect {...p} value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
              {teams.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <div className="space-y-1.5">
          <p className="text-meta font-medium text-fg">{t('fields')}</p>
          <ul className="flex flex-wrap gap-2">
            {(['name', 'phone', 'email', 'message'] as const).map((k) => (
              <li key={k} className="rounded-chip border border-line bg-surface px-3 py-1 text-meta text-fg">
                {t(`field.${k}`)}
              </li>
            ))}
          </ul>
          <p className="text-meta text-fg-2">{t('fieldsHint')}</p>
        </div>
      </div>
      <CopyBox label={t('linkLabel')} value={url} />
      <CopyBox label={t('embedLabel')} value={embed} />
      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() =>
            setF({ title: form.title, slug: form.slug, teamId: form.teamId, isActive: form.isActive })
          }
        >
          <RotateCcw aria-hidden className="size-4" />
          {tc('discard')}
        </Button>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!dirty || !slugOk}
          onClick={() => save.mutate()}
        >
          <Save aria-hidden className="size-4" />
          {tc('save')}
        </Button>
      </div>
    </Card>
  );
}

export function IntakeSettings() {
  const t = useTranslations('automations.intake');
  const tc = useTranslations('automations.common');
  const q = useIntake();
  if (q.isError)
    return (
      <Card role="alert" className="border-danger/40 bg-danger-surface">
        <p className="text-body text-fg">{tc('loadFailed')}</p>
        <Button className="mt-3" variant="secondary" onClick={() => void q.refetch()}>
          {tc('retry')}
        </Button>
      </Card>
    );
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-6">
      <section aria-labelledby="sources-title" className="space-y-3">
        <div>
          <h2 id="sources-title" className="text-panel text-fg">
            {t('sources')}
          </h2>
          <p className="text-meta text-fg-2">{t('sourcesHint')}</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {q.data.sources.map((s) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <li
                key={s.id}
                className="inline-flex items-center gap-2 rounded-chip border border-line bg-surface px-3 py-1.5 text-meta text-fg"
              >
                <Icon aria-hidden className="size-3.5 text-fg-2" />
                {s.label}
                <span className="text-fg-muted">· {t(`kind.${s.kind}`)}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="forms-title" className="space-y-3">
        <h2 id="forms-title" className="text-panel text-fg">
          {t('forms')}
        </h2>
        {q.data.forms.length === 0 ? <p className="text-body text-fg-2">{t('noForms')}</p> : null}
        {q.data.forms.map((f) => (
          <FormCard key={`${f.id}:${f.version}`} form={f} />
        ))}
      </section>
    </div>
  );
}
