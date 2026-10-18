'use client';
// Pipeline board + table (T-111, T-113): drag a card between stages (or use the per-card "move to" select),
// required fields enforced by the server and surfaced here, stale edits reloaded with a message.
import type { CrmEntity, FieldValue, OpportunityDto, StageDto } from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { ExportButton } from './export-button';
import { EMPTY_FILTER, FilterBar, filterParam, toCriteria, type FilterState } from './filter-bar';
import { ErrorNote, FieldInput, Money, has, ui, useFieldLabel, useLoad, useMe } from './ui';

interface Block {
  opp: OpportunityDto;
  stageId: string;
  missing: { fieldId: string; key: string; label: { en: string; ur: string }; entity: CrmEntity }[];
  values: Record<string, FieldValue | null>;
}

export function PipelineView() {
  const t = useTranslations('crm.pipeline');
  const me = useMe();
  const label = useFieldLabel();
  const [pipelineId, setPipelineId] = useState('');
  const [mode, setMode] = useState<'board' | 'table'>('board');
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [block, setBlock] = useState<Block | null>(null);
  const [adding, setAdding] = useState(false);

  const pipelines = useLoad(() => api.crm.pipelines.list(), 'pipelines');
  const current =
    pipelines.data?.items.find((p) => p.id === pipelineId) ??
    pipelines.data?.items.find((p) => p.isDefault) ??
    pipelines.data?.items[0];
  const pid = current?.id ?? '';
  const fields = useLoad(
    () =>
      pid ? api.crm.fields.list({ entity: 'opportunity', pipelineId: pid }) : Promise.resolve({ items: [] }),
    `fields:${pid}`,
  );
  const tags = useLoad(() => api.crm.tags.list(), 'tags');
  const canSeeValue = has(me, 'crm.opportunity.value.view');
  const criteria = toCriteria(filter, fields.data?.items ?? [], 'opportunity');
  const filterStr = filterParam(criteria);
  const key = JSON.stringify([pid, filterStr, filter.q, mode]);

  const board = useLoad(
    () =>
      pid && mode === 'board'
        ? api.crm.pipelines.board(pid, { filter: filterStr, q: filter.q || undefined })
        : Promise.resolve(null),
    `board:${key}`,
  );
  const table = useLoad(
    () =>
      pid && mode === 'table'
        ? api.crm.opportunities.list({
            pipelineId: pid,
            filter: filterStr,
            q: filter.q || undefined,
            limit: 100,
          })
        : Promise.resolve(null),
    `table:${key}`,
  );
  const reload = () => {
    board.reload();
    table.reload();
  };
  const owners = (board.data?.columns.flatMap((c) => c.opportunities) ?? table.data?.items ?? [])
    .flatMap((o) => (o.ownerUserId && o.ownerName ? [{ id: o.ownerUserId, name: o.ownerName }] : []))
    .concat(me ? [{ id: me.user.id, name: me.user.name }] : [])
    .filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i);

  async function moveTo(
    opp: OpportunityDto,
    stageId: string,
    fieldValues?: Record<string, FieldValue | null>,
  ) {
    if (opp.stageId === stageId) return;
    try {
      await api.crm.opportunities.move(opp.id, { stageId, version: opp.version, fields: fieldValues });
      setBlock(null);
      setError(null);
      setNotice(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REQUIRED_FIELDS_MISSING') {
        const details = err.details as { fields?: Block['missing'] } | undefined;
        setBlock({ opp, stageId, missing: details?.fields ?? [], values: fieldValues ?? {} });
        setError(null);
      } else if (err instanceof ApiError && err.code === 'STALE_VERSION') {
        setNotice(t('stale'));
      } else setError(err);
    }
    reload();
  }

  async function createOpp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = String(f.get('value') ?? '');
    try {
      await api.crm.opportunities.create({
        contactId: String(f.get('contact')),
        pipelineId: pid,
        title: String(f.get('title')),
        ...(value ? { valueMinor: Math.round(Number(value) * 100) } : {}),
      });
      setAdding(false);
      setError(null);
      reload();
    } catch (err) {
      setError(err);
    }
  }

  const contacts = useLoad(
    () => (adding ? api.crm.contacts.list({ limit: 100 }) : Promise.resolve(null)),
    `contacts:${adding}`,
  );
  const stages: StageDto[] = current?.stages ?? [];
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '';
  const missingDefs = (fields.data?.items ?? []).filter((f) =>
    block?.missing.some((m) => m.fieldId === f.id),
  );

  return (
    <div className="space-y-4">
      <header className={`${ui.row} justify-between`}>
        <h1 className={ui.h1}>{t('title')}</h1>
        <div className={ui.row}>
          <select
            className={ui.input}
            aria-label={t('pipeline')}
            value={pid}
            onChange={(e) => setPipelineId(e.target.value)}
          >
            {pipelines.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div role="group" aria-label={t('view')} className={ui.row}>
            {(['board', 'table'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={mode === m ? ui.btnPrimary : ui.btn}
                onClick={() => setMode(m)}
              >
                {t(m)}
              </button>
            ))}
          </div>
          <ExportButton entity="opportunity" filter={filterStr} />
          {has(me, 'crm.opportunity.create') && (
            <button type="button" className={ui.btnPrimary} onClick={() => setAdding((v) => !v)}>
              {t('new')}
            </button>
          )}
        </div>
      </header>

      <FilterBar
        entity="opportunity"
        value={filter}
        onChange={setFilter}
        tags={tags.data?.items ?? []}
        owners={owners}
        fields={fields.data?.items ?? []}
        stages={stages}
        canSeeValue={canSeeValue}
      />

      {adding && (
        <form onSubmit={createOpp} className={`${ui.panel} ${ui.row}`}>
          <select name="contact" required className={ui.input} aria-label={t('contact')}>
            {contacts.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            name="title"
            required
            className={ui.input}
            placeholder={t('titleField')}
            aria-label={t('titleField')}
          />
          {canSeeValue && (
            <input
              name="value"
              type="number"
              min={0}
              className={ui.input}
              placeholder={t('value')}
              aria-label={t('value')}
            />
          )}
          <button className={ui.btnPrimary}>{t('create')}</button>
        </form>
      )}

      {notice && (
        <p role="status" className={ui.info}>
          {notice}
        </p>
      )}
      <ErrorNote error={error ?? board.error ?? table.error} />

      {block && (
        <section role="alert" className={ui.alert} aria-labelledby="req-title">
          <h2 id="req-title" className={ui.h2}>
            {t('requiredTitle', { stage: stageName(block.stageId) })}
          </h2>
          <p>{t('requiredBody')}</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {block.missing.map((m) => {
              const def = missingDefs.find((f) => f.id === m.fieldId);
              return def && m.entity === 'opportunity' ? (
                <FieldInput
                  key={m.fieldId}
                  field={def}
                  value={block.values[m.fieldId] ?? undefined}
                  onChange={(v) => setBlock({ ...block, values: { ...block.values, [m.fieldId]: v } })}
                />
              ) : (
                <p key={m.fieldId}>
                  {label({ label: m.label })} · {t('setOnContact')}{' '}
                  <Link className="underline" href={`/contacts/${block.opp.contactId}`}>
                    {block.opp.contactName}
                  </Link>
                </p>
              );
            })}
          </div>
          <div className={`${ui.row} mt-2`}>
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => moveTo(block.opp, block.stageId, block.values)}
            >
              {t('fillAndMove')}
            </button>
            <button type="button" className={ui.btn} onClick={() => setBlock(null)}>
              {t('cancel')}
            </button>
          </div>
        </section>
      )}

      {mode === 'board' ? (
        board.loading || !board.data ? (
          <p aria-busy="true">{t('loading')}</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2" data-testid="board">
            {board.data.columns.map((col) => (
              <section
                key={col.stage.id}
                aria-label={col.stage.name}
                className="min-w-64 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain');
                  const opp = board.data?.columns.flatMap((c) => c.opportunities).find((o) => o.id === id);
                  if (opp) void moveTo(opp, col.stage.id);
                }}
              >
                <header className="mb-2 flex items-center justify-between">
                  <h2 className="font-medium">{col.stage.name}</h2>
                  <span className={ui.muted}>
                    {col.count} ·{' '}
                    {col.total.masked ? (
                      t('masked')
                    ) : (
                      <Money
                        value={{
                          masked: false,
                          amountMinor: col.total.value ?? 0,
                          currency: me?.workspace.currency ?? 'PKR',
                        }}
                      />
                    )}
                  </span>
                </header>
                <ul className="space-y-2">
                  {col.opportunities.map((o) => (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)}
                      className={`${ui.card} cursor-grab`}
                    >
                      <p className="font-medium">{o.title}</p>
                      <p className={ui.muted}>
                        <Link href={`/contacts/${o.contactId}`} className="underline">
                          {o.contactName}
                        </Link>
                      </p>
                      <p className="text-sm">
                        <Money value={o.value} />
                      </p>
                      {has(me, 'crm.opportunity.edit') && (
                        <select
                          className={`${ui.input} mt-1`}
                          aria-label={t('moveTo')}
                          value={o.stageId}
                          onChange={(e) => moveTo(o, e.target.value)}
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : table.loading || !table.data ? (
        <p aria-busy="true">{t('loading')}</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              {(['titleField', 'contact', 'stage', 'value', 'owner'] as const).map((c) => (
                <th key={c} className={ui.th} scope="col">
                  {t(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.data.items.map((o) => (
              <tr key={o.id}>
                <td className={ui.td}>{o.title}</td>
                <td className={ui.td}>
                  <Link href={`/contacts/${o.contactId}`} className="underline">
                    {o.contactName}
                  </Link>
                </td>
                <td className={ui.td}>{stageName(o.stageId)}</td>
                <td className={ui.td}>
                  <Money value={o.value} />
                </td>
                <td className={ui.td}>{o.ownerName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
