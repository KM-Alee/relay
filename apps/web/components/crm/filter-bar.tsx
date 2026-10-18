'use client';
// Filter bar (F2.6): combine tag, owner, date, stage, value and a custom field; the result is the same
// `Criteria` the server validates for `?filter=` and saved lists. The bar never trusts itself: the server
// re-validates every clause and the caller's permission to filter on it (Q9).
import {
  encodeFilter,
  type Criteria,
  type CriteriaClause,
  type CrmEntity,
  type CustomFieldDto,
  type StageDto,
  type TagDto,
} from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { ui, useFieldLabel } from './ui';

export interface FilterState {
  q: string;
  tagId: string;
  ownerId: string;
  withinDays: string;
  stageId: string;
  minValue: string;
  customFieldId: string;
  customValue: string;
}
export const EMPTY_FILTER: FilterState = {
  q: '',
  tagId: '',
  ownerId: '',
  withinDays: '',
  stageId: '',
  minValue: '',
  customFieldId: '',
  customValue: '',
};

export function toCriteria(s: FilterState, fields: CustomFieldDto[], entity: CrmEntity): Criteria {
  const clauses: CriteriaClause[] = [];
  if (s.tagId && entity !== 'company') clauses.push({ field: 'tag', op: 'in', value: [s.tagId] });
  if (s.ownerId) clauses.push({ field: 'owner', op: 'in', value: [s.ownerId] });
  if (s.withinDays) clauses.push({ field: 'created_at', op: 'within_days', value: Number(s.withinDays) });
  if (s.stageId && entity === 'opportunity') clauses.push({ field: 'stage', op: 'in', value: [s.stageId] });
  if (s.minValue && entity === 'opportunity')
    clauses.push({ field: 'value', op: 'gte', value: Math.round(Number(s.minValue) * 100) });
  const f = fields.find((x) => x.id === s.customFieldId);
  if (f && s.customValue !== '') {
    const value: string | number | boolean =
      f.type === 'number'
        ? Number(s.customValue)
        : f.type === 'checkbox'
          ? s.customValue === 'true'
          : s.customValue;
    clauses.push({ field: 'custom', fieldId: f.id, op: 'eq', value });
  }
  return { match: 'all', clauses };
}

export const filterParam = (c: Criteria): string | undefined =>
  c.clauses.length ? encodeFilter(c) : undefined;

export function FilterBar({
  entity,
  value,
  onChange,
  tags,
  owners,
  fields,
  stages,
  canSeeValue,
}: {
  entity: CrmEntity;
  value: FilterState;
  onChange: (s: FilterState) => void;
  tags: TagDto[];
  owners: { id: string; name: string }[];
  fields: CustomFieldDto[];
  stages?: StageDto[];
  canSeeValue?: boolean;
}) {
  const t = useTranslations('crm.filters');
  const label = useFieldLabel();
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const field = fields.find((f) => f.id === value.customFieldId);
  return (
    <form
      className={`${ui.row} ${ui.panel}`}
      role="search"
      onSubmit={(e) => e.preventDefault()}
      aria-label={t('title')}
    >
      <input
        className={ui.input}
        type="search"
        placeholder={t('search')}
        aria-label={t('search')}
        value={value.q}
        onChange={(e) => set({ q: e.target.value })}
      />
      {entity !== 'company' && (
        <select
          className={ui.input}
          aria-label={t('tag')}
          value={value.tagId}
          onChange={(e) => set({ tagId: e.target.value })}
        >
          <option value="">{t('anyTag')}</option>
          {tags.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
      <select
        className={ui.input}
        aria-label={t('owner')}
        value={value.ownerId}
        onChange={(e) => set({ ownerId: e.target.value })}
      >
        <option value="">{t('anyOwner')}</option>
        {owners.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <select
        className={ui.input}
        aria-label={t('created')}
        value={value.withinDays}
        onChange={(e) => set({ withinDays: e.target.value })}
      >
        <option value="">{t('anyDate')}</option>
        {[1, 7, 30, 90].map((d) => (
          <option key={d} value={d}>
            {t('withinDays', { days: d })}
          </option>
        ))}
      </select>
      {entity === 'opportunity' && stages && (
        <select
          className={ui.input}
          aria-label={t('stage')}
          value={value.stageId}
          onChange={(e) => set({ stageId: e.target.value })}
        >
          <option value="">{t('anyStage')}</option>
          {stages.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
      {entity === 'opportunity' && canSeeValue && (
        <input
          className={ui.input}
          type="number"
          min={0}
          placeholder={t('minValue')}
          aria-label={t('minValue')}
          value={value.minValue}
          onChange={(e) => set({ minValue: e.target.value })}
        />
      )}
      {fields.length > 0 && (
        <>
          <select
            className={ui.input}
            aria-label={t('customField')}
            value={value.customFieldId}
            onChange={(e) => set({ customFieldId: e.target.value, customValue: '' })}
          >
            <option value="">{t('anyField')}</option>
            {fields
              .filter((f) => f.type !== 'ai')
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {label(f)}
                </option>
              ))}
          </select>
          {field?.type === 'dropdown' ? (
            <select
              className={ui.input}
              aria-label={t('customValue')}
              value={value.customValue}
              onChange={(e) => set({ customValue: e.target.value })}
            >
              <option value="" />
              {field.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label.en}
                </option>
              ))}
            </select>
          ) : field?.type === 'checkbox' ? (
            <select
              className={ui.input}
              aria-label={t('customValue')}
              value={value.customValue}
              onChange={(e) => set({ customValue: e.target.value })}
            >
              <option value="" />
              <option value="true">{t('yes')}</option>
              <option value="false">{t('no')}</option>
            </select>
          ) : field ? (
            <input
              className={ui.input}
              type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
              aria-label={t('customValue')}
              value={value.customValue}
              onChange={(e) => set({ customValue: e.target.value })}
            />
          ) : null}
        </>
      )}
      <button type="button" className={ui.btn} onClick={() => onChange(EMPTY_FILTER)}>
        {t('clear')}
      </button>
    </form>
  );
}
