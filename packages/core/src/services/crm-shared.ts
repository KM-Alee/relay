// Shared CRM plumbing (T-110…T-118). Owner: Lane B. Services own transactions; these helpers take a `tx`.
import type { CrmEntity, FieldValue } from '@relay/contracts/api/crm';
import type { Tx } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { can } from '../auth/permissions';
import { contactScopeSql } from '../auth/visibility';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';

export type Row = Record<string, unknown>;

/** Run a query, return rows. */
export async function rows<T extends object = Row>(tx: Tx, query: SQL): Promise<T[]> {
  return (await tx.execute(query)).rows as unknown as T[];
}
export async function one<T extends object = Row>(tx: Tx, query: SQL): Promise<T | null> {
  return (await rows<T>(tx, query))[0] ?? null;
}

/** `(a::uuid, b::uuid)` list for IN clauses; empty list matches nothing. */
export function uuidList(ids: readonly string[]): SQL {
  return ids.length
    ? sql`(${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`
    : sql`(null::uuid)`;
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : new Date(d).toISOString();
export const isoReq = (d: Date | string): string => new Date(d).toISOString();

/** pg unique_violation (23505), possibly wrapped by drizzle's DrizzleQueryError. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = err.code ?? err.cause?.code;
  const name = err.constraint ?? err.cause?.constraint;
  return code === '23505' && (!constraint || (name ?? '').includes(constraint));
}

export const validationFailed = (path: string, code: string) =>
  new AppError('VALIDATION_FAILED', { details: { in: 'body', issues: [{ path, code }] } });

// ── Entity metadata (aliases are fixed constants, never user input) ──────
export const ENTITY = {
  contact: {
    table: 'contacts',
    alias: 'c',
    idCol: 'contact_id',
    view: 'crm.contact.view',
    realtime: 'contacts',
  },
  company: {
    table: 'companies',
    alias: 'co',
    idCol: 'company_id',
    view: 'crm.company.view',
    realtime: 'contacts',
  },
  opportunity: {
    table: 'opportunities',
    alias: 'o',
    idCol: 'opportunity_id',
    view: 'crm.opportunity.view',
    realtime: 'opportunities',
  },
} as const satisfies Record<CrmEntity, object>;

/** Record-visibility scope (F1.5, Q2) as a WHERE fragment on the entity's alias. */
export function scopeSql(actor: Actor, entity: CrmEntity): SQL {
  if (can(actor, 'leads.view_all')) return sql`true`;
  switch (entity) {
    case 'contact':
      return contactScopeSql(actor, sql.raw('c.id'), sql.raw('c.owner_user_id'));
    case 'opportunity':
      return contactScopeSql(actor, sql.raw('o.contact_id'));
    case 'company':
      return sql`(co.owner_user_id = ${actor.userId}::uuid or exists (
        select 1 from contacts c2 where c2.workspace_id = co.workspace_id and c2.company_id = co.id
          and c2.deleted_at is null and ${contactScopeSql(actor, sql.raw('c2.id'), sql.raw('c2.owner_user_id'))}))`;
  }
}

/** Opaque keyset cursor = the last id (uuid v7 is time-ordered, so id DESC is newest first). */
export function cursorSql(alias: string, cursor?: string): SQL {
  if (!cursor) return sql`true`;
  if (!/^[0-9a-f-]{36}$/i.test(cursor)) throw validationFailed('cursor', 'invalid_cursor');
  return sql`${sql.raw(alias)}.id < ${cursor}::uuid`;
}

export function pageOf<T extends { id: string }>(items: T[], limit: number) {
  const more = items.length > limit;
  const slice = more ? items.slice(0, limit) : items;
  return { items: slice, nextCursor: more ? slice[slice.length - 1]!.id : null };
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// ── Lookups ──────────────────────────────────────────────────────────────
/** The assignee must be an active user of this workspace. */
export async function assertActiveUser(tx: Tx, workspaceId: string, userId: string, path = 'ownerUserId') {
  const r = await one(
    tx,
    sql`select 1 as ok from users where workspace_id = ${workspaceId}::uuid and id = ${userId}::uuid and is_active`,
  );
  if (!r) throw validationFailed(path, 'user_not_found');
}

export async function assertCompanyExists(tx: Tx, workspaceId: string, companyId: string) {
  const r = await one(
    tx,
    sql`select 1 as ok from companies where workspace_id = ${workspaceId}::uuid and id = ${companyId}::uuid and deleted_at is null`,
  );
  if (!r) throw validationFailed('companyId', 'company_not_found');
}

export interface TagRef {
  id: string;
  name: string;
}

export async function loadTags(
  tx: Tx,
  entity: 'contact' | 'opportunity',
  ids: readonly string[],
): Promise<Map<string, TagRef[]>> {
  const out = new Map<string, TagRef[]>();
  if (!ids.length) return out;
  const join = entity === 'contact' ? 'contact_tags' : 'opportunity_tags';
  const col = entity === 'contact' ? 'contact_id' : 'opportunity_id';
  const rs = await rows<{ rid: string; id: string; name: string }>(
    tx,
    sql`select j.${sql.raw(col)} as rid, t.id, t.name from ${sql.raw(join)} j join tags t on t.workspace_id = j.workspace_id and t.id = j.tag_id
        where j.${sql.raw(col)} in ${uuidList(ids)} order by lower(t.name)`,
  );
  for (const r of rs) out.set(r.rid, [...(out.get(r.rid) ?? []), { id: r.id, name: r.name }]);
  return out;
}

export async function loadFieldValues(
  tx: Tx,
  entity: CrmEntity,
  ids: readonly string[],
): Promise<Map<string, Record<string, FieldValue>>> {
  const out = new Map<string, Record<string, FieldValue>>();
  if (!ids.length) return out;
  const col = ENTITY[entity].idCol;
  const rs = await rows<{ rid: string; field_id: string; value: FieldValue }>(
    tx,
    sql`select ${sql.raw(col)} as rid, field_id, value from field_values where ${sql.raw(col)} in ${uuidList(ids)}`,
  );
  for (const r of rs) out.set(r.rid, { ...(out.get(r.rid) ?? {}), [r.field_id]: r.value });
  return out;
}

export interface FieldRow extends Row {
  id: string;
  entity: CrmEntity;
  pipeline_id: string | null;
  key: string;
  label: { en: string; ur: string };
  type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'ai';
  options: { value: string; label: { en: string; ur: string } }[];
  /** `ai` fields only (F9.1). */
  ai_config?: { prompt: string; outputType: 'text' | 'dropdown' | 'number' } | null;
}

export async function loadFields(tx: Tx, ids: readonly string[]): Promise<Map<string, FieldRow>> {
  const rs = ids.length
    ? await rows<FieldRow>(tx, sql`select * from custom_fields where id in ${uuidList(ids)}`)
    : [];
  return new Map(rs.map((r) => [r.id, r]));
}

function validValue(f: FieldRow, v: FieldValue): boolean {
  switch (f.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'checkbox':
      return typeof v === 'boolean';
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    case 'dropdown':
      return typeof v === 'string' && f.options.some((o) => o.value === v);
    case 'ai': {
      // An AI field stores the answer in its configured output shape (F9.1); a human may override it.
      const out = f.ai_config?.outputType ?? 'text';
      if (out === 'number') return typeof v === 'number' && Number.isFinite(v);
      if (out === 'dropdown') return typeof v === 'string' && f.options.some((o) => o.value === v);
      return typeof v === 'string';
    }
    default:
      return typeof v === 'string';
  }
}

export interface FieldChange {
  fieldId: string;
  key: string;
  from: FieldValue | null;
  to: FieldValue | null;
}

/**
 * Validate + upsert custom-field values for one record (F2.2/F2.3). `null` clears. Pipeline-specific
 * fields only apply to opportunities of that pipeline. Returns the effective changes (for field_edit).
 */
export async function saveFieldValues(
  tx: Tx,
  actor: Actor,
  entity: CrmEntity,
  recordId: string,
  values: Record<string, FieldValue | null>,
  opts: { pipelineId?: string; source?: 'human' | 'import' | 'ai' } = {},
): Promise<FieldChange[]> {
  const ids = Object.keys(values);
  if (!ids.length) return [];
  const defs = await loadFields(tx, ids);
  for (const id of ids) {
    const f = defs.get(id);
    const v = values[id];
    if (!f || f.entity !== entity || (f.pipeline_id && f.pipeline_id !== opts.pipelineId))
      throw validationFailed(`fields.${id}`, 'unknown_field');
    if (v !== null && v !== undefined && !validValue(f, v))
      throw validationFailed(`fields.${id}`, 'invalid_value');
  }
  const col = ENTITY[entity].idCol;
  const existing = await rows<{ field_id: string; value: FieldValue; source: string }>(
    tx,
    sql`select field_id, value, source from field_values where ${sql.raw(col)} = ${recordId}::uuid and field_id in ${uuidList(ids)}`,
  );
  const prev = new Map(existing.map((r) => [r.field_id, r.value]));
  const prevSource = new Map(existing.map((r) => [r.field_id, r.source]));
  const source = opts.source ?? 'human';
  // An AI answer has no human author; a person saving the same text still takes ownership (human wins).
  const updatedBy = source === 'ai' ? null : actor.userId;
  const changes: FieldChange[] = [];
  for (const id of ids) {
    const next = values[id] ?? null;
    const before = prev.get(id) ?? null;
    if (JSON.stringify(before) === JSON.stringify(next)) {
      if (next !== null && prevSource.get(id) !== source && source === 'human')
        await tx.execute(
          sql`update field_values set source = 'human', updated_by = ${updatedBy}::uuid, updated_at = now()
              where field_id = ${id}::uuid and ${sql.raw(col)} = ${recordId}::uuid`,
        );
      continue;
    }
    if (next === null) {
      await tx.execute(
        sql`delete from field_values where field_id = ${id}::uuid and ${sql.raw(col)} = ${recordId}::uuid`,
      );
    } else if (before === null) {
      await tx.execute(
        sql`insert into field_values (id, workspace_id, field_id, ${sql.raw(col)}, value, source, updated_by)
            values (${uuidv7()}::uuid, ${actor.workspaceId}::uuid, ${id}::uuid, ${recordId}::uuid, ${JSON.stringify(next)}::jsonb,
                    ${source}, ${updatedBy}::uuid)`,
      );
    } else {
      await tx.execute(
        sql`update field_values set value = ${JSON.stringify(next)}::jsonb, source = ${source},
                updated_by = ${updatedBy}::uuid, updated_at = now()
            where field_id = ${id}::uuid and ${sql.raw(col)} = ${recordId}::uuid`,
      );
    }
    changes.push({ fieldId: id, key: defs.get(id)!.key, from: before, to: next });
  }
  return changes;
}

/** Display names for a set of user ids (owner / actor columns). */
export async function userNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (!uniq.length) return new Map();
  const rs = await rows<{ id: string; name: string }>(
    tx,
    sql`select id, name from users where id in ${uuidList(uniq)}`,
  );
  return new Map(rs.map((r) => [r.id, r.name]));
}
