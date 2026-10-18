// Pipelines, stages, board, stage moves, stage-required fields (T-111, T-113, F2.4, F2.5). Owner: Lane B.
import type { OpportunityDto, PipelineDto, StageDto } from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { maskMoneyFigure } from '../auth/mask';
import { assertPermission } from '../auth/permissions';
import { AppError, notFound, staleVersion } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import { rottingRows } from '../repos/crm-rot';
import { recordActivity } from './crm-activity';
import {
  buildWhere,
  checkVersion,
  dtoById,
  emitRecordHint,
  lockRecord,
  opportunityDtos,
  type OpportunityRow,
} from './crm-records';
import {
  isUniqueViolation,
  loadFields,
  one,
  rows,
  saveFieldValues,
  scopeSql,
  uuidList,
  validationFailed,
} from './crm-shared';

interface PipelineRow {
  id: string;
  name: string;
  team_id: string | null;
  position: number;
  is_default: boolean;
  version: number;
}
interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  kind: 'open' | 'won' | 'lost';
  rot_seconds: number | null;
  version: number;
}

const DEFAULT_STAGES: { name: string; kind: 'open' | 'won' | 'lost' }[] = [
  { name: 'New', kind: 'open' },
  { name: 'Qualified', kind: 'open' },
  { name: 'Proposal', kind: 'open' },
  { name: 'Won', kind: 'won' },
  { name: 'Lost', kind: 'lost' },
];

/** Insert a pipeline with stages inside the caller's tx (also used by signup provisioning and seeds). */
export async function createPipelineIn(
  tx: Tx,
  workspaceId: string,
  p: {
    name: string;
    isDefault?: boolean;
    teamId?: string | null;
    stages?: { name: string; kind: 'open' | 'won' | 'lost' }[];
  },
): Promise<string> {
  const id = uuidv7();
  const pos = await one<{ n: number }>(
    tx,
    sql`select coalesce(max(position) + 1, 0)::int as n from pipelines`,
  );
  await tx.execute(
    sql`insert into pipelines (id, workspace_id, name, team_id, position, is_default)
        values (${id}::uuid, ${workspaceId}::uuid, ${p.name}, ${p.teamId ?? null}::uuid, ${pos?.n ?? 0}, ${p.isDefault ?? false})`,
  );
  const stages = p.stages?.length ? p.stages : DEFAULT_STAGES;
  for (const [i, s] of stages.entries())
    await tx.execute(
      sql`insert into stages (id, workspace_id, pipeline_id, name, position, kind)
          values (${uuidv7()}::uuid, ${workspaceId}::uuid, ${id}::uuid, ${s.name}, ${i}, ${s.kind})`,
    );
  return id;
}

async function loadPipelines(tx: Tx, actor: Actor, onlyId?: string): Promise<PipelineDto[]> {
  const ps = await rows<PipelineRow>(
    tx,
    sql`select id, name, team_id, position, is_default, version from pipelines
        where workspace_id = ${actor.workspaceId}::uuid ${onlyId ? sql`and id = ${onlyId}::uuid` : sql``} order by position, id`,
  );
  if (!ps.length) return [];
  const ss = await rows<StageRow>(
    tx,
    sql`select id, pipeline_id, name, position, kind, rot_seconds, version from stages
        where pipeline_id in ${uuidList(ps.map((p) => p.id))} order by position`,
  );
  const req = await rows<{ stage_id: string; field_id: string }>(
    tx,
    sql`select stage_id, field_id from stage_required_fields where stage_id in ${uuidList(ss.map((s) => s.id))}`,
  );
  const stageDto = (s: StageRow): StageDto => ({
    id: s.id,
    pipelineId: s.pipeline_id,
    name: s.name,
    position: s.position,
    kind: s.kind,
    rotSeconds: s.rot_seconds,
    requiredFieldIds: req.filter((r) => r.stage_id === s.id).map((r) => r.field_id),
    version: s.version,
  });
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    teamId: p.team_id,
    position: p.position,
    isDefault: p.is_default,
    version: p.version,
    stages: ss.filter((s) => s.pipeline_id === p.id).map(stageDto),
  }));
}

async function pipelineOr404(tx: Tx, actor: Actor, id: string): Promise<PipelineDto> {
  const p = (await loadPipelines(tx, actor, id))[0];
  if (!p) throw notFound();
  return p;
}

async function setRequiredFields(tx: Tx, actor: Actor, stage: StageRow, fieldIds: string[]) {
  const defs = await loadFields(tx, fieldIds);
  for (const fid of fieldIds) {
    const f = defs.get(fid);
    if (!f || (f.pipeline_id && f.pipeline_id !== stage.pipeline_id))
      throw validationFailed('requiredFieldIds', 'unknown_field');
  }
  await tx.execute(sql`delete from stage_required_fields where stage_id = ${stage.id}::uuid`);
  for (const fid of new Set(fieldIds))
    await tx.execute(
      sql`insert into stage_required_fields (workspace_id, stage_id, field_id) values (${actor.workspaceId}::uuid, ${stage.id}::uuid, ${fid}::uuid)`,
    );
}

async function lockStage(tx: Tx, id: string): Promise<StageRow> {
  const s = await one<StageRow>(tx, sql`select * from stages where id = ${id}::uuid for update`);
  if (!s) throw notFound();
  return s;
}

/** F2.4: required fields of `stageId` that the opportunity (or its contact / company) is still missing. */
export async function missingRequiredFields(
  tx: Tx,
  stageId: string,
  opp: { id: string; contact_id: string },
) {
  return rows<{
    field_id: string;
    key: string;
    label: { en: string; ur: string };
    entity: 'contact' | 'company' | 'opportunity';
  }>(
    tx,
    sql`select f.id as field_id, f.key, f.label, f.entity
        from stage_required_fields r join custom_fields f on f.workspace_id = r.workspace_id and f.id = r.field_id
        where r.stage_id = ${stageId}::uuid and not exists (
          select 1 from field_values v where v.field_id = f.id and (
            (f.entity = 'opportunity' and v.opportunity_id = ${opp.id}::uuid)
            or (f.entity = 'contact' and v.contact_id = ${opp.contact_id}::uuid)
            or (f.entity = 'company' and v.company_id = (select company_id from contacts where id = ${opp.contact_id}::uuid))))
        order by f.position, f.key`,
  );
}

const reorderCompact = async (tx: Tx, pipelineId: string) => {
  const ss = await rows<{ id: string }>(
    tx,
    sql`select id from stages where pipeline_id = ${pipelineId}::uuid order by position`,
  );
  for (const [i, s] of ss.entries())
    await tx.execute(sql`update stages set position = ${i} where id = ${s.id}::uuid`);
};

export const pipelinesService = {
  /** GET /pipelines (crm.opportunity.view): all pipelines with stages + required fields. */
  async list(actor: Actor, opts: TxOptions = {}) {
    assertPermission(actor, 'crm.opportunity.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => ({ items: await loadPipelines(tx, actor) }),
      opts,
    );
  },

  async create(
    actor: Actor,
    input: {
      name: string;
      teamId?: string | null;
      stages?: { name: string; kind: 'open' | 'won' | 'lost' }[];
    },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        let id: string;
        try {
          const first = !(await one(tx, sql`select 1 as x from pipelines limit 1`));
          id = await createPipelineIn(tx, actor.workspaceId, { ...input, isDefault: first });
        } catch (e) {
          if (isUniqueViolation(e, 'name')) throw new AppError('CONFLICT', { details: { field: 'name' } });
          throw e;
        }
        await auditAppend(tx, actor, {
          action: 'pipeline.created',
          targetType: 'pipeline',
          targetId: id,
          after: { name: input.name },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return pipelineOr404(tx, actor, id);
      },
      opts,
    );
  },

  async update(
    actor: Actor,
    id: string,
    input: { name?: string; teamId?: string | null; isDefault?: true; version: number },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await one<PipelineRow>(
          tx,
          sql`select * from pipelines where id = ${id}::uuid for update`,
        );
        if (!cur) throw notFound();
        if (cur.version !== input.version) throw staleVersion(await pipelineOr404(tx, actor, id));
        if (input.isDefault)
          await tx.execute(
            sql`update pipelines set is_default = false where is_default and id <> ${id}::uuid`,
          );
        try {
          await tx.execute(
            sql`update pipelines set name = ${input.name ?? cur.name},
                  team_id = ${input.teamId === undefined ? cur.team_id : input.teamId}::uuid,
                  is_default = ${input.isDefault ? true : cur.is_default}, version = version + 1
                where id = ${id}::uuid and version = ${input.version}`,
          );
        } catch (e) {
          if (isUniqueViolation(e, 'name')) throw new AppError('CONFLICT', { details: { field: 'name' } });
          throw e;
        }
        await auditAppend(tx, actor, {
          action: 'pipeline.updated',
          targetType: 'pipeline',
          targetId: id,
          before: { name: cur.name },
          after: { name: input.name ?? cur.name, isDefault: input.isDefault ?? cur.is_default },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return pipelineOr404(tx, actor, id);
      },
      opts,
    );
  },

  /** DELETE /pipelines/:id: only an empty, non-default pipeline (no opportunity rows, even soft-deleted). */
  async remove(actor: Actor, id: string, opts: TxOptions = {}) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await one<PipelineRow>(
          tx,
          sql`select * from pipelines where id = ${id}::uuid for update`,
        );
        if (!cur) throw notFound();
        if (cur.is_default)
          throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'default_pipeline' } });
        const n = await one<{ n: number }>(
          tx,
          sql`select count(*)::int as n from opportunities where pipeline_id = ${id}::uuid`,
        );
        if ((n?.n ?? 0) > 0)
          throw new AppError('BUSINESS_RULE_VIOLATION', {
            details: { reason: 'pipeline_not_empty', count: n!.n },
          });
        await tx.execute(sql`delete from custom_fields where pipeline_id = ${id}::uuid`);
        await tx.execute(sql`delete from stages where pipeline_id = ${id}::uuid`);
        await tx.execute(sql`delete from pipelines where id = ${id}::uuid`);
        await auditAppend(tx, actor, {
          action: 'pipeline.deleted',
          targetType: 'pipeline',
          targetId: id,
          before: { name: cur.name },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return { ok: true as const };
      },
      opts,
    );
  },

  async addStage(
    actor: Actor,
    pipelineId: string,
    input: { name: string; kind: 'open' | 'won' | 'lost'; requiredFieldIds: string[] },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        await pipelineOr404(tx, actor, pipelineId);
        const pos = await one<{ n: number }>(
          tx,
          sql`select coalesce(max(position) + 1, 0)::int as n from stages where pipeline_id = ${pipelineId}::uuid`,
        );
        const id = uuidv7();
        await tx.execute(
          sql`insert into stages (id, workspace_id, pipeline_id, name, position, kind)
              values (${id}::uuid, ${actor.workspaceId}::uuid, ${pipelineId}::uuid, ${input.name}, ${pos?.n ?? 0}, ${input.kind})`,
        );
        if (input.requiredFieldIds.length)
          await setRequiredFields(tx, actor, await lockStage(tx, id), input.requiredFieldIds);
        await auditAppend(tx, actor, {
          action: 'stage.created',
          targetType: 'stage',
          targetId: id,
          after: { name: input.name, pipelineId },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return pipelineOr404(tx, actor, pipelineId);
      },
      opts,
    );
  },

  async updateStage(
    actor: Actor,
    stageId: string,
    input: {
      name?: string;
      kind?: 'open' | 'won' | 'lost';
      requiredFieldIds?: string[];
      /** F2.9 rot period in seconds; null clears; undefined keeps. Won/lost stages cannot rot. */
      rotSeconds?: number | null;
      version: number;
    },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lockStage(tx, stageId);
        if (cur.version !== input.version)
          throw staleVersion(await pipelineOr404(tx, actor, cur.pipeline_id));
        const kind = input.kind ?? cur.kind;
        let rot = input.rotSeconds === undefined ? cur.rot_seconds : input.rotSeconds;
        if (kind !== 'open') {
          if (input.rotSeconds != null) throw validationFailed('rotSeconds', 'open_stage_only');
          rot = null; // closing a stage drops its rot period
        }
        await tx.execute(
          sql`update stages set name = ${input.name ?? cur.name}, kind = ${kind}, rot_seconds = ${rot}, version = version + 1
              where id = ${stageId}::uuid and version = ${input.version}`,
        );
        if (input.requiredFieldIds) await setRequiredFields(tx, actor, cur, input.requiredFieldIds);
        await auditAppend(tx, actor, {
          action: 'stage.updated',
          targetType: 'stage',
          targetId: stageId,
          before: { name: cur.name, kind: cur.kind, rotSeconds: cur.rot_seconds },
          after: {
            name: input.name ?? cur.name,
            kind,
            rotSeconds: rot,
            requiredFieldIds: input.requiredFieldIds,
          },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return pipelineOr404(tx, actor, cur.pipeline_id);
      },
      opts,
    );
  },

  /** POST /pipelines/:id/stages/reorder: the body must list every stage of the pipeline exactly once. */
  async reorderStages(actor: Actor, pipelineId: string, stageIds: string[], opts: TxOptions = {}) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        await pipelineOr404(tx, actor, pipelineId);
        const cur = await rows<{ id: string }>(
          tx,
          sql`select id from stages where pipeline_id = ${pipelineId}::uuid for update`,
        );
        const a = [...cur.map((s) => s.id)].sort().join();
        const b = [...stageIds].sort().join();
        if (a !== b || new Set(stageIds).size !== stageIds.length)
          throw validationFailed('stageIds', 'must_list_every_stage');
        for (const [i, id] of stageIds.entries())
          await tx.execute(
            sql`update stages set position = ${i}, version = version + 1 where id = ${id}::uuid`,
          );
        await auditAppend(tx, actor, {
          action: 'stage.reordered',
          targetType: 'pipeline',
          targetId: pipelineId,
          after: { stageIds },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return pipelineOr404(tx, actor, pipelineId);
      },
      opts,
    );
  },

  /**
   * DELETE /stages/:id (F2.5). A stage holding opportunities needs `moveToStageId`: they are moved (with
   * stage_change activities), then the stage is deleted, all in ONE transaction. Audited incl. the forced move.
   */
  async deleteStage(actor: Actor, stageId: string, input: { moveToStageId?: string }, opts: TxOptions = {}) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const stage = await lockStage(tx, stageId);
        const count =
          (
            await one<{ n: number }>(
              tx,
              sql`select count(*)::int as n from opportunities where stage_id = ${stageId}::uuid`,
            )
          )?.n ?? 0;
        const siblings =
          (
            await one<{ n: number }>(
              tx,
              sql`select count(*)::int as n from stages where pipeline_id = ${stage.pipeline_id}::uuid`,
            )
          )?.n ?? 0;
        if (siblings <= 1)
          throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'last_stage' } });
        let moved = 0;
        if (count > 0) {
          if (!input.moveToStageId)
            throw new AppError('BUSINESS_RULE_VIOLATION', {
              details: { reason: 'move_target_required', count },
            });
          const target = await one<StageRow>(
            tx,
            sql`select * from stages where id = ${input.moveToStageId}::uuid`,
          );
          if (!target || target.pipeline_id !== stage.pipeline_id || target.id === stage.id)
            throw validationFailed('moveToStageId', 'invalid_target');
          const closed = target.kind === 'open' ? sql`null` : sql`now()`;
          const movedRows = await rows<{ id: string; contact_id: string; deleted_at: Date | null }>(
            tx,
            sql`update opportunities set stage_id = ${target.id}::uuid, stage_entered_at = now(), closed_at = ${closed}, version = version + 1
                where stage_id = ${stageId}::uuid returning id, contact_id, deleted_at`,
          );
          moved = movedRows.length;
          for (const o of movedRows.filter((m) => !m.deleted_at))
            await recordActivity(tx, actor, {
              contactId: o.contact_id,
              opportunityId: o.id,
              type: 'stage_change',
              payload: {
                fromStageId: stage.id,
                fromStage: stage.name,
                toStageId: target.id,
                toStage: target.name,
                forced: true,
              },
            });
        }
        await tx.execute(sql`delete from stages where id = ${stageId}::uuid`);
        await reorderCompact(tx, stage.pipeline_id);
        await auditAppend(tx, actor, {
          action: 'stage.deleted',
          targetType: 'stage',
          targetId: stageId,
          before: { name: stage.name },
          meta: { movedToStageId: input.moveToStageId ?? null, movedCount: moved },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return { ok: true as const, movedCount: moved };
      },
      opts,
    );
  },

  /**
   * GET /pipelines/:id/board (crm.opportunity.view): one column per stage with a page of cards, a count
   * and a total. Totals and card values are masked (F1.4); scope and filters apply to cards and counts.
   */
  async board(
    actor: Actor,
    pipelineId: string,
    query: { filter?: string; q?: string },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.opportunity.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const pipeline = await pipelineOr404(tx, actor, pipelineId);
        const { where } = await buildWhere(tx, actor, 'opportunity', {
          q: query.q,
          filter: query.filter,
          extra: sql`o.pipeline_id = ${pipelineId}::uuid`,
        });
        const agg = await rows<{ stage_id: string; n: number; total: string | null }>(
          tx,
          sql`select o.stage_id, count(*)::int as n, sum(o.value_minor)::text as total
              from opportunities o join contacts c on c.workspace_id = o.workspace_id and c.id = o.contact_id
              where ${where} group by o.stage_id`,
        );
        const cards = await rows<OpportunityRow & { rn: number }>(
          tx,
          sql`select * from (
                select o.*, c.name as contact_name, u.name as owner_name,
                       row_number() over (partition by o.stage_id order by o.stage_entered_at desc, o.id desc) as rn
                from opportunities o join contacts c on c.workspace_id = o.workspace_id and c.id = o.contact_id
                left join users u on u.workspace_id = o.workspace_id and u.id = o.owner_user_id
                where ${where}) x where x.rn <= 50 order by x.stage_entered_at desc, x.id desc`,
        );
        const dtos = await opportunityDtos(tx, actor, cards);
        // F2.9: which of the shown cards are past their stage's rot period (one shared definition).
        const rot = pipeline.stages.some((st) => st.rotSeconds)
          ? await rottingRows(tx, {
              workspaceId: actor.workspaceId,
              scope: scopeSql(actor, 'opportunity'),
              pipelineId,
              ids: cards.map((c) => c.id),
            })
          : [];
        const byStage = new Map<string, OpportunityDto[]>();
        for (const d of dtos) byStage.set(d.stageId, [...(byStage.get(d.stageId) ?? []), d]);
        return {
          pipeline,
          rotting: Object.fromEntries(rot.map((r) => [r.id, Number(r.idle_seconds)])),
          columns: pipeline.stages.map((stage) => {
            const a = agg.find((x) => x.stage_id === stage.id);
            return {
              stage,
              count: a?.n ?? 0,
              total: maskMoneyFigure(actor, a?.total ? Number(a.total) : 0),
              opportunities: byStage.get(stage.id) ?? [],
            };
          }),
        };
      },
      opts,
    );
  },
};

/**
 * POST /opportunities/:id/move (crm.opportunity.edit, F2.4/F2.5). Stale version → 409. Required fields of
 * the target stage are enforced HERE, on the server: missing ones → 422 REQUIRED_FIELDS_MISSING listing them.
 * `fields` lets the caller fill them in the same request; the whole move is atomic.
 */
export async function moveOpportunity(
  actor: Actor,
  id: string,
  input: { stageId: string; version: number; fields?: Record<string, string | number | boolean | null> },
  opts: TxOptions = {},
): Promise<OpportunityDto> {
  assertPermission(actor, 'crm.opportunity.edit');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const cur = await lockRecord<OpportunityRow>(tx, actor, 'opportunity', id);
      await checkVersion(tx, actor, 'opportunity', id, cur.version, input.version);
      const target = await one<StageRow>(tx, sql`select * from stages where id = ${input.stageId}::uuid`);
      if (!target || target.pipeline_id !== cur.pipeline_id)
        throw validationFailed('stageId', 'stage_not_found');
      if (target.id === cur.stage_id) return dtoById(tx, actor, 'opportunity', id);
      if (input.fields)
        await saveFieldValues(tx, actor, 'opportunity', id, input.fields, { pipelineId: cur.pipeline_id });
      const missing = await missingRequiredFields(tx, target.id, { id, contact_id: cur.contact_id });
      if (missing.length)
        throw new AppError('REQUIRED_FIELDS_MISSING', {
          details: {
            stageId: target.id,
            fields: missing.map((m) => ({
              fieldId: m.field_id,
              key: m.key,
              label: m.label,
              entity: m.entity,
            })),
          },
        });
      const from = await one<{ name: string }>(
        tx,
        sql`select name from stages where id = ${cur.stage_id}::uuid`,
      );
      await tx.execute(
        sql`update opportunities set stage_id = ${target.id}::uuid, stage_entered_at = now(),
              closed_at = ${target.kind === 'open' ? sql`null` : sql`now()`}, version = version + 1
            where id = ${id}::uuid and version = ${input.version}`,
      );
      await recordActivity(tx, actor, {
        contactId: cur.contact_id,
        opportunityId: id,
        type: 'stage_change',
        payload: {
          fromStageId: cur.stage_id,
          fromStage: from?.name,
          toStageId: target.id,
          toStage: target.name,
        },
      });
      await emitRecordHint(tx, actor, 'opportunity', id);
      return dtoById(tx, actor, 'opportunity', id);
    },
    opts,
  );
}
