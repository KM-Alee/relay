'use client';
// Custom fields settings (T-112, F2.2, F2.3): text / number / date / dropdown / checkbox, shared across
// pipelines or specific to one pipeline's opportunities. Deleting cascades values (the API confirms nothing
// dangles), so the screen asks first.
import type { CrmEntity, CustomFieldDto } from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';
import { ErrorNote, ui, useFieldLabel, useLoad } from './ui';

export function SettingsFields() {
  const t = useTranslations('crm.settings.fields');
  const label = useFieldLabel();
  const [error, setError] = useState<unknown>(null);
  const [entity, setEntity] = useState<CrmEntity>('contact');
  const [type, setType] = useState<CustomFieldDto['type']>('text');
  const fields = useLoad(() => api.crm.fields.list(), 'fields:all');
  const pipelines = useLoad(() => api.crm.pipelines.list(), 'pipelines');

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const en = String(f.get('optionsEn') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ur = String(f.get('optionsUr') ?? '')
      .split(',')
      .map((s) => s.trim());
    const pipelineId = String(f.get('pipeline') ?? '');
    try {
      await api.crm.fields.create({
        entity,
        pipelineId: entity === 'opportunity' && pipelineId ? pipelineId : null,
        key: String(f.get('key')),
        label: { en: String(f.get('labelEn')), ur: String(f.get('labelUr') || f.get('labelEn')) },
        type,
        options:
          type === 'dropdown'
            ? en.map((label, i) => ({
                value:
                  label
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_|_$/g, '') || `opt_${i}`,
                label: { en: label, ur: ur[i] || label },
              }))
            : [],
      });
      form.reset();
      setError(null);
      fields.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function remove(f: CustomFieldDto) {
    if (!window.confirm(t('confirmDelete', { name: label(f) }))) return;
    try {
      await api.crm.fields.delete(f.id);
      setError(null);
    } catch (err) {
      setError(err);
    }
    fields.reload();
  }

  const pipelineName = (id: string | null) =>
    id ? pipelines.data?.items.find((p) => p.id === id)?.name : null;

  return (
    <div className="space-y-4">
      <h1 className={ui.h1}>{t('title')}</h1>
      <p className={ui.muted}>{t('intro')}</p>
      <ErrorNote error={error ?? fields.error} />
      {(['contact', 'company', 'opportunity'] as const).map((e) => (
        <section key={e} className={ui.card} aria-label={t(`entities.${e}`)}>
          <h2 className={ui.h2}>{t(`entities.${e}`)}</h2>
          <ul className="space-y-1">
            {(fields.data?.items ?? [])
              .filter((f) => f.entity === e)
              .map((f) => (
                <li key={f.id} className={ui.row}>
                  <span>{label(f)}</span>
                  <span className={ui.chip}>{t(`types.${f.type}`)}</span>
                  <span className={ui.chip}>{pipelineName(f.pipelineId) ?? t('shared')}</span>
                  <button type="button" className={ui.btnDanger} onClick={() => remove(f)}>
                    {t('delete')}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <form onSubmit={create} className={`${ui.panel} ${ui.row}`} aria-label={t('add')}>
        <select
          className={ui.input}
          aria-label={t('entity')}
          value={entity}
          onChange={(e) => setEntity(e.target.value as CrmEntity)}
        >
          {(['contact', 'company', 'opportunity'] as const).map((e) => (
            <option key={e} value={e}>
              {t(`entities.${e}`)}
            </option>
          ))}
        </select>
        {entity === 'opportunity' && (
          <select name="pipeline" className={ui.input} aria-label={t('scope')} defaultValue="">
            <option value="">{t('shared')}</option>
            {pipelines.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <input
          name="key"
          required
          pattern="[a-z][a-z0-9_]{0,39}"
          className={ui.input}
          placeholder={t('key')}
          aria-label={t('key')}
        />
        <input
          name="labelEn"
          required
          className={ui.input}
          placeholder={t('labelEn')}
          aria-label={t('labelEn')}
        />
        <input
          name="labelUr"
          dir="rtl"
          className={ui.input}
          placeholder={t('labelUr')}
          aria-label={t('labelUr')}
        />
        <select
          className={ui.input}
          aria-label={t('type')}
          value={type}
          onChange={(e) => setType(e.target.value as CustomFieldDto['type'])}
        >
          {(['text', 'number', 'date', 'dropdown', 'checkbox'] as const).map((x) => (
            <option key={x} value={x}>
              {t(`types.${x}`)}
            </option>
          ))}
        </select>
        {type === 'dropdown' && (
          <>
            <input
              name="optionsEn"
              required
              className={ui.input}
              placeholder={t('optionsEn')}
              aria-label={t('optionsEn')}
            />
            <input
              name="optionsUr"
              dir="rtl"
              className={ui.input}
              placeholder={t('optionsUr')}
              aria-label={t('optionsUr')}
            />
          </>
        )}
        <button className={ui.btnPrimary}>{t('create')}</button>
      </form>
    </div>
  );
}
