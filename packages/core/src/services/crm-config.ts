// Custom fields (T-112, F2.2/F2.3) and tags (T-114, F2.1): config CRUD with safe deletes. Owner: Lane B.
import type { AiConfig, CrmEntity, CustomFieldDto, TagDto } from '@relay/contracts/api/crm';
import { criteriaSchema } from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { AppError, notFound, staleVersion } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import { stripFromCriteria } from './crm-criteria';
import {
  ENTITY,
  isUniqueViolation,
  one,
  rows,
  scopeSql,
  validationFailed,
  type FieldRow,
} from './crm-shared';

const toDto = (r: FieldRow & { position: number; version: number }): CustomFieldDto => ({
  id: r.id,
  entity: r.entity,
  pipelineId: r.pipeline_id,
  key: r.key,
  label: r.label,
  type: r.type,
  options: r.options,
  aiConfig: r.type === 'ai' ? (r.ai_config ?? null) : null,
  position: r.position,
  version: r.version,
});

/** Rewrite saved lists that used a deleted field/tag: drop the clause, flag `needs_review` (02 §3). */
async function rewriteLists(tx: Tx, gone: { fieldId?: string; tagId?: string }) {
  const needle = gone.fieldId ?? gone.tagId!;
  const ls = await rows<{ id: string; criteria: unknown }>(
    tx,
    sql`select id, criteria from saved_lists where criteria::text like ${'%' + needle + '%'}`,
  );
  for (const l of ls) {
    const parsed = criteriaSchema.safeParse(l.criteria);
    if (!parsed.success) continue;
    const r = stripFromCriteria(parsed.data, gone);
    if (r.changed)
      await tx.execute(
        sql`update saved_lists set criteria = ${JSON.stringify(r.criteria)}::jsonb, needs_review = true, version = version + 1 where id = ${l.id}::uuid`,
      );
  }
}

function checkOptions(type: string, options: unknown[], aiOutput?: string | null) {
  // An AI field with a dropdown output picks from options, like a dropdown (F9.1).
  const needs = type === 'dropdown' || (type === 'ai' && aiOutput === 'dropdown');
  if (needs && options.length === 0) throw validationFailed('options', 'options_required');
  if (!needs && options.length) throw validationFailed('options', 'options_not_allowed');
}

export const customFieldsService = {
  /** GET /custom-fields (any CRM view permission). `pipelineId` → shared + that pipeline's opportunity fields. */
  async list(actor: Actor, query: { entity?: CrmEntity; pipelineId?: string }, opts: TxOptions = {}) {
    if (
      !['crm.contact.view', 'crm.company.view', 'crm.opportunity.view'].some(
        (k) => actor.baseLevel === 'owner' || actor.permissions.has(k as never),
      )
    )
      assertPermission(actor, 'crm.contact.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const rs = await rows<FieldRow & { position: number; version: number }>(
          tx,
          sql`select * from custom_fields where workspace_id = ${actor.workspaceId}::uuid
              ${query.entity ? sql`and entity = ${query.entity}` : sql``}
              ${query.pipelineId ? sql`and (pipeline_id is null or pipeline_id = ${query.pipelineId}::uuid)` : sql``}
              order by entity, position, key`,
        );
        return { items: rs.map(toDto) };
      },
      opts,
    );
  },

  async create(
    actor: Actor,
    input: {
      entity: CrmEntity;
      pipelineId: string | null;
      key: string;
      label: { en: string; ur: string };
      type: CustomFieldDto['type'];
      options: CustomFieldDto['options'];
      aiConfig?: AiConfig | null;
    },
    opts: TxOptions = {},
  ): Promise<CustomFieldDto> {
    assertPermission(actor, 'crm.config.manage');
    if (input.type === 'ai') {
      if (!input.aiConfig) throw validationFailed('aiConfig', 'ai_config_required');
      // AI answers come from the conversation, so only records tied to a contact can have one.
      if (input.entity === 'company') throw validationFailed('entity', 'ai_entity_unsupported');
    } else if (input.aiConfig) throw validationFailed('aiConfig', 'ai_only');
    checkOptions(input.type, input.options, input.aiConfig?.outputType);
    if (input.pipelineId && input.entity !== 'opportunity')
      throw validationFailed('pipelineId', 'opportunity_only');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        if (
          input.pipelineId &&
          !(await one(tx, sql`select 1 as x from pipelines where id = ${input.pipelineId}::uuid`))
        )
          throw validationFailed('pipelineId', 'pipeline_not_found');
        const id = uuidv7();
        const pos = await one<{ n: number }>(
          tx,
          sql`select coalesce(max(position) + 1, 0)::int as n from custom_fields where entity = ${input.entity}`,
        );
        try {
          await tx.execute(
            sql`insert into custom_fields (id, workspace_id, entity, pipeline_id, key, label, type, options, ai_config, position)
                values (${id}::uuid, ${actor.workspaceId}::uuid, ${input.entity}, ${input.pipelineId}::uuid, ${input.key},
                        ${JSON.stringify(input.label)}::jsonb, ${input.type}, ${JSON.stringify(input.options)}::jsonb,
                        ${input.aiConfig ? JSON.stringify(input.aiConfig) : null}::jsonb, ${pos?.n ?? 0})`,
          );
        } catch (e) {
          if (isUniqueViolation(e, 'custom_fields_ws_entity_key'))
            throw new AppError('CONFLICT', { details: { field: 'key' } });
          throw e;
        }
        await auditAppend(tx, actor, {
          action: 'field.created',
          targetType: 'custom_field',
          targetId: id,
          after: { entity: input.entity, key: input.key, type: input.type, pipelineId: input.pipelineId },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'contacts' });
        const r = await one<FieldRow & { position: number; version: number }>(
          tx,
          sql`select * from custom_fields where id = ${id}::uuid`,
        );
        return toDto(r!);
      },
      opts,
    );
  },

  async update(
    actor: Actor,
    id: string,
    input: {
      label?: { en: string; ur: string };
      options?: CustomFieldDto['options'];
      aiConfig?: AiConfig;
      position?: number;
      version: number;
    },
    opts: TxOptions = {},
  ): Promise<CustomFieldDto> {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await one<FieldRow & { position: number; version: number }>(
          tx,
          sql`select * from custom_fields where id = ${id}::uuid for update`,
        );
        if (!cur) throw notFound();
        if (cur.version !== input.version) throw staleVersion(toDto(cur));
        if (input.aiConfig && cur.type !== 'ai') throw validationFailed('aiConfig', 'ai_only');
        const aiConfig = input.aiConfig ?? cur.ai_config ?? null;
        if (input.options || input.aiConfig)
          checkOptions(cur.type, input.options ?? cur.options, aiConfig?.outputType);
        await tx.execute(
          sql`update custom_fields set label = ${JSON.stringify(input.label ?? cur.label)}::jsonb,
                options = ${JSON.stringify(input.options ?? cur.options)}::jsonb, position = ${input.position ?? cur.position},
                ai_config = ${aiConfig ? JSON.stringify(aiConfig) : null}::jsonb,
                version = version + 1 where id = ${id}::uuid and version = ${input.version}`,
        );
        await auditAppend(tx, actor, {
          action: 'field.updated',
          targetType: 'custom_field',
          targetId: id,
          before: { key: cur.key },
        });
        const r = await one<FieldRow & { position: number; version: number }>(
          tx,
          sql`select * from custom_fields where id = ${id}::uuid`,
        );
        return toDto(r!);
      },
      opts,
    );
  },

  /** DELETE: values + stage-required links cascade (FK); saved-list clauses are dropped and flagged. */
  async remove(actor: Actor, id: string, opts: TxOptions = {}) {
    assertPermission(actor, 'crm.config.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await one<FieldRow>(
          tx,
          sql`select * from custom_fields where id = ${id}::uuid for update`,
        );
        if (!cur) throw notFound();
        await rewriteLists(tx, { fieldId: id });
        await tx.execute(sql`delete from custom_fields where id = ${id}::uuid`);
        await auditAppend(tx, actor, {
          action: 'field.deleted',
          targetType: 'custom_field',
          targetId: id,
          before: { entity: cur.entity, key: cur.key },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'contacts' });
        return { ok: true as const };
      },
      opts,
    );
  },
};

// ── Tags ─────────────────────────────────────────────────────────────────
async function tagDtos(tx: Tx, onlyId?: string): Promise<TagDto[]> {
  const rs = await rows<{ id: string; name: string; contact_count: number; opportunity_count: number }>(
    tx,
    sql`select t.id, t.name,
          (select count(*)::int from contact_tags x where x.tag_id = t.id) as contact_count,
          (select count(*)::int from opportunity_tags x where x.tag_id = t.id) as opportunity_count
        from tags t ${onlyId ? sql`where t.id = ${onlyId}::uuid` : sql``} order by lower(t.name)`,
  );
  return rs.map((r) => ({
    id: r.id,
    name: r.name,
    contactCount: r.contact_count,
    opportunityCount: r.opportunity_count,
  }));
}

export const tagsService = {
  /** GET /tags: anyone who can view contacts or opportunities (tags are labels, not records). */
  async list(actor: Actor, opts: TxOptions = {}) {
    return withWorkspaceTx(actor.workspaceId, async (tx) => ({ items: await tagDtos(tx) }), opts);
  },

  async create(actor: Actor, input: { name: string }, opts: TxOptions = {}): Promise<TagDto> {
    assertPermission(actor, 'crm.tags.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const id = uuidv7();
        try {
          await tx.execute(
            sql`insert into tags (id, workspace_id, name) values (${id}::uuid, ${actor.workspaceId}::uuid, ${input.name})`,
          );
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError('CONFLICT', { details: { field: 'name' } });
          throw e;
        }
        await auditAppend(tx, actor, {
          action: 'tag.created',
          targetType: 'tag',
          targetId: id,
          after: { name: input.name },
        });
        return (await tagDtos(tx, id))[0]!;
      },
      opts,
    );
  },

  async rename(actor: Actor, id: string, input: { name: string }, opts: TxOptions = {}): Promise<TagDto> {
    assertPermission(actor, 'crm.tags.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await one<{ name: string }>(
          tx,
          sql`select name from tags where id = ${id}::uuid for update`,
        );
        if (!cur) throw notFound();
        try {
          await tx.execute(sql`update tags set name = ${input.name} where id = ${id}::uuid`);
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError('CONFLICT', { details: { field: 'name' } });
          throw e;
        }
        await auditAppend(tx, actor, {
          action: 'tag.renamed',
          targetType: 'tag',
          targetId: id,
          before: { name: cur.name },
          after: { name: input.name },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'contacts' });
        return (await tagDtos(tx, id))[0]!;
      },
      opts,
    );
  },

  /** DELETE: join rows cascade (FK) so nothing dangles; saved-list tag clauses are cleaned and flagged. */
  async remove(actor: Actor, id: string, opts: TxOptions = {}) {
    assertPermission(actor, 'crm.tags.manage');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await one<{ name: string }>(
          tx,
          sql`select name from tags where id = ${id}::uuid for update`,
        );
        if (!cur) throw notFound();
        await rewriteLists(tx, { tagId: id });
        await tx.execute(sql`delete from tags where id = ${id}::uuid`);
        await auditAppend(tx, actor, {
          action: 'tag.deleted',
          targetType: 'tag',
          targetId: id,
          before: { name: cur.name },
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'contacts' });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'opportunities' });
        return { ok: true as const };
      },
      opts,
    );
  },

  /** Attach / detach on a contact or opportunity (needs the entity's `.edit`; out-of-scope record → 404). */
  async setOnRecord(
    actor: Actor,
    entity: 'contact' | 'opportunity',
    recordId: string,
    tagId: string,
    attach: boolean,
    opts: TxOptions = {},
  ): Promise<void> {
    assertPermission(actor, entity === 'contact' ? 'crm.contact.edit' : 'crm.opportunity.edit');
    await withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const m = ENTITY[entity];
        const a = sql.raw(m.alias);
        const rec = await one(
          tx,
          sql`select ${a}.id from ${sql.raw(m.table)} ${a} where ${a}.workspace_id = ${actor.workspaceId}::uuid and ${a}.id = ${recordId}::uuid
              and ${a}.deleted_at is null and ${scopeSql(actor, entity)}`,
        );
        if (!rec) throw notFound();
        if (!(await one(tx, sql`select 1 as x from tags where id = ${tagId}::uuid`))) throw notFound();
        const join = sql.raw(entity === 'contact' ? 'contact_tags' : 'opportunity_tags');
        const col = sql.raw(m.idCol);
        if (attach)
          await tx.execute(
            sql`insert into ${join} (workspace_id, tag_id, ${col}) values (${actor.workspaceId}::uuid, ${tagId}::uuid, ${recordId}::uuid) on conflict do nothing`,
          );
        else
          await tx.execute(
            sql`delete from ${join} where tag_id = ${tagId}::uuid and ${col} = ${recordId}::uuid`,
          );
        await emit(tx, { workspaceId: actor.workspaceId, topic: m.realtime, ids: [recordId] });
      },
      opts,
    );
  },
};
