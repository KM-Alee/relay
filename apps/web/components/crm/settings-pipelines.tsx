'use client';
// Pipelines & stages settings (T-111, T-113, F2.4, F2.5): add / rename / reorder / delete-with-forced-move,
// stage-required fields. crm.config.manage is enforced by the API; this screen is only reachable with it.
import type { CustomFieldDto, PipelineDto, StageDto } from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { splitDuration } from './rot';
import { ErrorNote, ui, useFieldLabel, useLoad } from './ui';

const UNIT_SECONDS = { day: 86_400, hour: 3600, minute: 60 } as const;
type RotUnit = keyof typeof UNIT_SECONDS;

export function SettingsPipelines() {
  const t = useTranslations('crm.settings.pipelines');
  const [error, setError] = useState<unknown>(null);
  const pipelines = useLoad(() => api.crm.pipelines.list(), 'pipelines');
  const fields = useLoad(() => api.crm.fields.list(), 'fields:all');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      pipelines.reload();
    }
  };

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await run(async () => {
      await api.crm.pipelines.create({ name: String(new FormData(form).get('name')) });
      form.reset();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className={ui.h1}>{t('title')}</h1>
      <p className={ui.muted}>{t('intro')}</p>
      <ErrorNote error={error ?? pipelines.error} />
      {pipelines.data?.items.map((p) => (
        <PipelineCard key={p.id} p={p} fields={fields.data?.items ?? []} run={run} />
      ))}
      <form onSubmit={create} className={`${ui.panel} ${ui.row}`}>
        <input
          name="name"
          required
          className={ui.input}
          placeholder={t('newName')}
          aria-label={t('newName')}
        />
        <button className={ui.btnPrimary}>{t('create')}</button>
      </form>
    </div>
  );
}

function PipelineCard({
  p,
  fields,
  run,
}: {
  p: PipelineDto;
  fields: CustomFieldDto[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations('crm.settings.pipelines');
  const [name, setName] = useState(p.name);
  const [stageName, setStageName] = useState('');

  return (
    <section className={ui.card} aria-label={p.name}>
      <header className={`${ui.row} mb-2 justify-between`}>
        <div className={ui.row}>
          <input
            className={ui.input}
            value={name}
            aria-label={t('pipelineName')}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className={ui.btn}
            onClick={() => run(() => api.crm.pipelines.update(p.id, { name, version: p.version }))}
          >
            {t('rename')}
          </button>
          {p.isDefault ? (
            <span className={ui.chip}>{t('default')}</span>
          ) : (
            <>
              <button
                type="button"
                className={ui.btn}
                onClick={() =>
                  run(() => api.crm.pipelines.update(p.id, { isDefault: true, version: p.version }))
                }
              >
                {t('makeDefault')}
              </button>
              <button
                type="button"
                className={ui.btnDanger}
                onClick={() =>
                  window.confirm(t('confirmDeletePipeline', { name: p.name })) &&
                  run(() => api.crm.pipelines.delete(p.id))
                }
              >
                {t('deletePipeline')}
              </button>
            </>
          )}
        </div>
      </header>
      <ol className="space-y-2">
        {p.stages.map((s, i) => (
          <StageRow key={`${s.id}:${s.version}`} s={s} p={p} index={i} fields={fields} run={run} />
        ))}
      </ol>
      <form
        className={`${ui.row} mt-2`}
        onSubmit={(e) => {
          e.preventDefault();
          if (stageName.trim())
            void run(() =>
              api.crm.pipelines.addStage(p.id, {
                name: stageName.trim(),
                kind: 'open',
                requiredFieldIds: [],
              }),
            ).then(() => setStageName(''));
        }}
      >
        <input
          className={ui.input}
          value={stageName}
          placeholder={t('newStage')}
          aria-label={t('newStage')}
          onChange={(e) => setStageName(e.target.value)}
        />
        <button className={ui.btn}>{t('addStage')}</button>
      </form>
    </section>
  );
}

function StageRow({
  s,
  p,
  index,
  fields,
  run,
}: {
  s: StageDto;
  p: PipelineDto;
  index: number;
  fields: CustomFieldDto[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations('crm.settings.pipelines');
  const label = useFieldLabel();
  const [name, setName] = useState(s.name);
  const [kind, setKind] = useState(s.kind);
  const [req, setReq] = useState<string[]>(s.requiredFieldIds);
  const [target, setTarget] = useState<string | null>(null);
  const initialRot = s.rotSeconds ? splitDuration(s.rotSeconds) : null;
  const [rotN, setRotN] = useState(initialRot ? String(initialRot.n) : '');
  const [rotUnit, setRotUnit] = useState<RotUnit>(initialRot?.unit ?? 'day');
  const applicable = fields.filter((f) => !f.pipelineId || f.pipelineId === p.id);

  const move = (delta: number) => {
    const ids = p.stages.map((x) => x.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void run(() => api.crm.pipelines.reorderStages(p.id, ids));
  };

  async function del(moveToStageId?: string) {
    try {
      await api.crm.pipelines.deleteStage(s.id, moveToStageId);
      await run(async () => undefined);
    } catch (err) {
      // A non-empty stage needs a target stage (F2.5): ask for one instead of failing.
      if (
        err instanceof ApiError &&
        (err.details as { reason?: string } | undefined)?.reason === 'move_target_required'
      )
        setTarget(p.stages.find((x) => x.id !== s.id)?.id ?? '');
      else await run(() => Promise.reject(err));
    }
  }

  return (
    <li className="rounded-md border border-[var(--border)] p-2">
      <div className={ui.row}>
        <button
          type="button"
          className={ui.btn}
          aria-label={t('moveUp')}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className={ui.btn}
          aria-label={t('moveDown')}
          disabled={index === p.stages.length - 1}
          onClick={() => move(1)}
        >
          ↓
        </button>
        <input
          className={ui.input}
          value={name}
          aria-label={t('stageName')}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={ui.input}
          aria-label={t('stageKind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as StageDto['kind'])}
        >
          {(['open', 'won', 'lost'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={ui.btn}
          onClick={() =>
            run(() =>
              api.crm.pipelines.updateStage(s.id, {
                name,
                kind,
                requiredFieldIds: req,
                rotSeconds:
                  kind === 'open' && rotN !== ''
                    ? Math.max(1, Math.round(Number(rotN) * UNIT_SECONDS[rotUnit]))
                    : null,
                version: s.version,
              }),
            )
          }
        >
          {t('saveStage')}
        </button>
        <button type="button" className={ui.btnDanger} onClick={() => del()}>
          {t('deleteStage')}
        </button>
      </div>
      {kind === 'open' && (
        <div className={`${ui.row} mt-2`}>
          <label htmlFor={`rot-${s.id}`} className={ui.muted}>
            {t('rotAfter')}
          </label>
          <input
            id={`rot-${s.id}`}
            type="number"
            min={1}
            step="any"
            className={`${ui.input} w-24`}
            placeholder={t('rotOff')}
            value={rotN}
            onChange={(e) => setRotN(e.target.value)}
          />
          <select
            className={ui.input}
            aria-label={t('rotUnit')}
            value={rotUnit}
            onChange={(e) => setRotUnit(e.target.value as RotUnit)}
          >
            {(['day', 'hour', 'minute'] as const).map((u) => (
              <option key={u} value={u}>
                {t(`rotUnits.${u}`)}
              </option>
            ))}
          </select>
          <span className={ui.muted}>{t('rotHint')}</span>
        </div>
      )}
      {applicable.length > 0 && (
        <fieldset className="mt-2">
          <legend className={ui.muted}>{t('requiredFields')}</legend>
          <div className={ui.row}>
            {applicable.map((f) => (
              <label key={f.id} className={ui.row}>
                <input
                  type="checkbox"
                  checked={req.includes(f.id)}
                  onChange={(e) => setReq(e.target.checked ? [...req, f.id] : req.filter((x) => x !== f.id))}
                />
                {label(f)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {target !== null && (
        <div role="alert" className={`${ui.info} mt-2 ${ui.row}`}>
          <span>{t('moveTargetPrompt')}</span>
          <select
            className={ui.input}
            aria-label={t('moveTarget')}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {p.stages
              .filter((x) => x.id !== s.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
          <button type="button" className={ui.btnDanger} onClick={() => del(target)}>
            {t('moveAndDelete')}
          </button>
          <button type="button" className={ui.btn} onClick={() => setTarget(null)}>
            {t('cancel')}
          </button>
        </div>
      )}
    </li>
  );
}
