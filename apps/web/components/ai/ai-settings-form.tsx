'use client';
// AI behaviour settings (T-208, F6.1): stand-in mode, wait, triage, voice, daily cost cap. `ai.manage` only
// (the page and the API both enforce it).
import type { AiSettingsDto, AiSettingsInput } from '@relay/contracts/api/ai';
import { STANDIN_MODES } from '@relay/contracts/api/ai';
import { Info, ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FormField } from '@/components/relay/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { fieldClass, Input } from '@/components/ui/input';
import { cn } from '@/components/ui/cn';
import { api, localizeError } from '@/lib/api-client';
import { AiAdminShell, Toggle } from './admin-shell';

export function AiSettingsForm() {
  const t = useTranslations('ai');
  const tAll = useTranslations();
  const fmt = useFormatter();
  const [saved, setSaved] = useState<AiSettingsDto | null>(null);
  const [form, setForm] = useState<AiSettingsInput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    api.ai.settings.get().then(
      (d) => {
        setSaved(d);
        setForm({
          standinMode: d.standinMode,
          triggerUnackedSeconds: d.triggerUnackedSeconds,
          dailyCostCapUsd: d.dailyCostCapUsd,
          triageEnabled: d.triageEnabled,
          transcribeEnabled: d.transcribeEnabled,
          aiEnabled: d.aiEnabled,
        });
      },
      (e) => setErr(localizeError(e, tAll as never)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!form || !saved) {
    return (
      <AiAdminShell active="settings">
        {err ? (
          <p role="alert" className="text-body text-danger">
            {err}
          </p>
        ) : (
          <p aria-busy="true" className="text-body text-fg-2">
            {t('admin.loading')}
          </p>
        )}
      </AiAdminShell>
    );
  }

  const set = <K extends keyof AiSettingsInput>(k: K, v: AiSettingsInput[K]) => {
    setForm({ ...form, [k]: v });
    setState('idle');
  };
  const money = (n: number) =>
    fmt.number(n, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const pct =
    form.dailyCostCapUsd > 0
      ? Math.min(100, Math.round((saved.spentTodayUsd / form.dailyCostCapUsd) * 100))
      : 100;

  async function save() {
    setState('saving');
    setErr(null);
    try {
      const d = await api.ai.settings.put(form!);
      setSaved(d);
      setState('saved');
    } catch (e) {
      setErr(localizeError(e, tAll as never));
      setState('idle');
    }
  }

  return (
    <AiAdminShell active="settings">
      <div className="flex flex-col gap-5">
        {!saved.globalEnabled ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-card bg-info-surface p-4 text-body text-info"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t('settings.globalOff')}</span>
          </p>
        ) : !form.aiEnabled ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-card bg-info-surface p-4 text-body text-info"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t('settings.workspaceOff')}</span>
          </p>
        ) : null}

        <Card>
          <CardHeader title={t('settings.master.title')} />
          <div className="mt-4">
            <Toggle
              checked={form.aiEnabled}
              onChange={(v) => set('aiEnabled', v)}
              label={t('settings.master.label')}
              helper={t('settings.master.helper')}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('settings.standin.title')} description={t('settings.standin.description')} />
          <div className="mt-4 flex flex-col gap-4">
            <FormField label={t('settings.standin.mode')}>
              {(p) => (
                <select
                  {...p}
                  className={cn(fieldClass, 'h-11 sm:h-10')}
                  value={form.standinMode}
                  onChange={(e) => set('standinMode', e.target.value as AiSettingsInput['standinMode'])}
                >
                  {STANDIN_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`settings.standin.modes.${m}`)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            {form.standinMode === 'unacked' ? (
              <FormField label={t('settings.standin.seconds')} helper={t('settings.standin.secondsHelper')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={10}
                    max={3600}
                    className="max-w-40"
                    value={form.triggerUnackedSeconds}
                    onChange={(e) => set('triggerUnackedSeconds', Number(e.target.value))}
                  />
                )}
              </FormField>
            ) : null}
            <p className="flex items-start gap-2 rounded-control bg-surface-muted p-3 text-meta text-fg-2">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{t('settings.standin.guard')}</span>
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title={t('settings.triage.title')} />
          <div className="mt-4 flex flex-col gap-4">
            <Toggle
              checked={form.triageEnabled}
              onChange={(v) => set('triageEnabled', v)}
              label={t('settings.triage.label')}
              helper={t('settings.triage.helper')}
            />
            <Toggle
              checked={form.transcribeEnabled}
              onChange={(v) => set('transcribeEnabled', v)}
              label={t('settings.voice.label')}
              helper={t('settings.voice.helper')}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('settings.budget.title')} />
          <div className="mt-4 flex flex-col gap-4">
            <FormField label={t('settings.budget.cap')} helper={t('settings.budget.capHelper')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1000}
                  step={0.5}
                  className="max-w-40"
                  value={form.dailyCostCapUsd}
                  onChange={(e) => set('dailyCostCapUsd', Number(e.target.value))}
                />
              )}
            </FormField>
            <div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={t('settings.budget.usage', { pct })}
                className="h-2 w-full overflow-hidden rounded-chip bg-surface-muted"
              >
                <div className="h-full rounded-chip bg-ai" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 flex flex-wrap justify-between gap-2 text-meta text-fg-2">
                <span>{t('settings.budget.spent', { amount: money(saved.spentTodayUsd) })}</span>
                <span>{t('settings.budget.usage', { pct })}</span>
              </p>
            </div>
          </div>
        </Card>

        {err ? (
          <p role="alert" className="text-body text-danger">
            {err}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Button variant="primary" loading={state === 'saving'} onClick={save}>
            {t('admin.save')}
          </Button>
          <span role="status" className="text-meta text-fg-2">
            {state === 'saved' ? t('admin.saved') : ''}
          </span>
        </div>
      </div>
    </AiAdminShell>
  );
}
