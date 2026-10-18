// Filter criteria: server-side validation + compilation to SQL (T-115, F2.6, Q9). Owner: Lane B.
// ONE schema for ad-hoc `?filter=` and saved lists. Lists are never materialised: membership is
// evaluated at query time, so records entering/leaving the criteria change membership by themselves.
import {
  criteriaSchema,
  decodeFilter,
  type Criteria,
  type CriteriaClause,
  type CrmEntity,
} from '@relay/contracts/api/crm';
import type { Tx } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { can } from '../auth/permissions';
import { AppError, forbidden } from '../errors';
import { ENTITY, escapeLike, loadFields, uuidList, type FieldRow } from './crm-shared';

const issue = (path: string, code: string) =>
  new AppError('VALIDATION_FAILED', { details: { in: 'query', issues: [{ path, code }] } });

/** Which built-in fields each entity supports. */
const ALLOWED: Record<CrmEntity, ReadonlySet<CriteriaClause['field']>> = {
  contact: new Set(['tag', 'owner', 'company', 'name', 'created_at', 'last_activity_at', 'custom']),
  company: new Set(['owner', 'name', 'created_at', 'custom']),
  opportunity: new Set([
    'tag',
    'owner',
    'stage',
    'pipeline',
    'name',
    'value',
    'created_at',
    'last_activity_at',
    'stage_entered_at',
    'custom',
  ]),
};

const CUSTOM_OPS: Record<FieldRow['type'], ReadonlySet<string>> = {
  text: new Set(['eq', 'neq', 'contains', 'in', 'is_empty', 'not_empty']),
  ai: new Set(['eq', 'neq', 'contains', 'in', 'is_empty', 'not_empty']),
  dropdown: new Set(['eq', 'neq', 'in', 'is_empty', 'not_empty']),
  number: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty']),
  date: new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'older_than_days', 'within_days', 'is_empty', 'not_empty']),
  checkbox: new Set(['eq', 'is_empty', 'not_empty']),
};

export interface CompiledCriteria {
  criteria: Criteria;
  where: SQL;
}

/** Decode + parse the `?filter=` transport value. Anything malformed → 400. */
export function parseCriteria(raw: unknown): Criteria {
  let json: unknown = raw;
  if (typeof raw === 'string') {
    try {
      json = decodeFilter(raw);
    } catch {
      throw issue('filter', 'invalid_filter');
    }
  }
  const r = criteriaSchema.safeParse(json);
  if (!r.success) throw issue(`filter.${r.error.issues[0]?.path.join('.') ?? ''}`, 'invalid_filter');
  return r.data;
}

/**
 * Validate criteria against the entity + the caller (supported fields, existing custom fields with a
 * compatible op/value, permission to filter on opportunity value) and compile to a WHERE fragment on the
 * entity alias. Returns `where = true` for an empty criteria.
 */
export async function compileCriteria(
  tx: Tx,
  actor: Actor,
  entity: CrmEntity,
  criteria: Criteria,
): Promise<CompiledCriteria> {
  const customIds = criteria.clauses.flatMap((c) => (c.field === 'custom' ? [c.fieldId] : []));
  const fields = await loadFields(tx, customIds);
  const parts: SQL[] = [];
  criteria.clauses.forEach((c, i) => {
    const path = `filter.clauses.${i}`;
    if (!ALLOWED[entity].has(c.field)) throw issue(path, 'field_not_supported');
    if (c.field === 'value' && !can(actor, 'crm.opportunity.value.view')) throw forbidden({ field: 'value' });
    parts.push(clauseSql(entity, actor.workspaceId, c, fields, path));
  });
  const where = !parts.length
    ? sql`true`
    : sql`(${sql.join(parts, criteria.match === 'any' ? sql` or ` : sql` and `)})`;
  return { criteria, where };
}

/** Does this criteria reference the opportunity value? (viewers without the permission can't evaluate it) */
export const usesValue = (c: Criteria): boolean => c.clauses.some((x) => x.field === 'value');

function clauseSql(
  entity: CrmEntity,
  ws: string,
  c: CriteriaClause,
  fields: Map<string, FieldRow>,
  path: string,
): SQL {
  const a = sql.raw(ENTITY[entity].alias);
  switch (c.field) {
    case 'tag': {
      const join = entity === 'contact' ? 'contact_tags' : 'opportunity_tags';
      const col = entity === 'contact' ? 'contact_id' : 'opportunity_id';
      const ex = sql`exists (select 1 from ${sql.raw(join)} t where t.${sql.raw(col)} = ${a}.id and t.tag_id in ${uuidList(c.value)})`;
      return c.op === 'in' ? ex : sql`not ${ex}`;
    }
    case 'owner': {
      if (c.op === 'unassigned') return sql`${a}.owner_user_id is null`;
      if (!c.value) throw issue(path, 'value_required');
      const inn = sql`${a}.owner_user_id in ${uuidList(c.value)}`;
      return c.op === 'in' ? inn : sql`(${a}.owner_user_id is null or not ${inn})`;
    }
    case 'stage':
      return c.op === 'in'
        ? sql`o.stage_id in ${uuidList(c.value)}`
        : sql`o.stage_id not in ${uuidList(c.value)}`;
    case 'pipeline':
      return sql`o.pipeline_id in ${uuidList(c.value)}`;
    case 'company':
      return sql`c.company_id in ${uuidList(c.value)}`;
    case 'name': {
      const col = entity === 'opportunity' ? sql`o.title` : sql`${a}.name`;
      return c.op === 'equals'
        ? sql`lower(${col}) = lower(${c.value})`
        : sql`${col} ilike ${'%' + escapeLike(c.value) + '%'}`;
    }
    case 'value':
      return c.op === 'gte' ? sql`o.value_minor >= ${c.value}` : sql`o.value_minor <= ${c.value}`;
    case 'created_at':
    case 'last_activity_at':
    case 'stage_entered_at':
      return dateSql(sql`${a}.${sql.raw(c.field)}`, c.op, c.value, path);
    case 'custom':
      return customSql(entity, ws, c, fields.get(c.fieldId), path);
  }
}

function dateSql(col: SQL, op: string, value: string | number, path: string): SQL {
  if (op === 'older_than_days' || op === 'within_days') {
    if (typeof value !== 'number') throw issue(path, 'value_invalid');
    return op === 'older_than_days'
      ? sql`${col} < now() - make_interval(days => ${value})`
      : sql`${col} >= now() - make_interval(days => ${value})`;
  }
  if (typeof value !== 'string') throw issue(path, 'value_invalid');
  return op === 'before' ? sql`${col} < ${value}::date` : sql`${col} >= ${value}::date`;
}

function customSql(
  entity: CrmEntity,
  ws: string,
  c: Extract<CriteriaClause, { field: 'custom' }>,
  f: FieldRow | undefined,
  path: string,
): SQL {
  if (!f || f.entity !== entity) throw issue(path, 'unknown_field');
  if (!CUSTOM_OPS[f.type].has(c.op)) throw issue(path, 'op_not_supported');
  const a = sql.raw(ENTITY[entity].alias);
  const col = sql.raw(ENTITY[entity].idCol);
  const base = sql`fv.workspace_id = ${ws}::uuid and fv.field_id = ${f.id}::uuid and fv.${col} = ${a}.id`;
  const exists = (cond: SQL) => sql`exists (select 1 from field_values fv where ${base} and ${cond})`;
  if (c.op === 'is_empty') return sql`not ${exists(sql`true`)}`;
  if (c.op === 'not_empty') return exists(sql`true`);
  const v = c.value;
  const txt = sql`(fv.value #>> '{}')`;
  if (f.type === 'checkbox') {
    if (typeof v !== 'boolean') throw issue(path, 'value_invalid');
    return v ? exists(sql`fv.value = 'true'::jsonb`) : sql`not ${exists(sql`fv.value = 'true'::jsonb`)}`;
  }
  if (f.type === 'number') {
    if (typeof v !== 'number') throw issue(path, 'value_invalid');
    const n = sql`(fv.value #>> '{}')::numeric`;
    const cmp = { eq: sql`=`, gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` } as const;
    if (c.op === 'neq') return sql`not ${exists(sql`${n} = ${v}`)}`;
    return exists(sql`${n} ${cmp[c.op as keyof typeof cmp]} ${v}`);
  }
  if (f.type === 'date') {
    const d = sql`(fv.value #>> '{}')::date`;
    if (c.op === 'older_than_days' || c.op === 'within_days') {
      if (typeof v !== 'number') throw issue(path, 'value_invalid');
      return exists(
        c.op === 'older_than_days'
          ? sql`${d} < current_date - ${v}::int`
          : sql`${d} >= current_date - ${v}::int`,
      );
    }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw issue(path, 'value_invalid');
    const cmp = { eq: sql`=`, gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` } as const;
    return exists(sql`${d} ${cmp[c.op as keyof typeof cmp]} ${v}::date`);
  }
  // text / dropdown / ai
  if (c.op === 'in') {
    if (!Array.isArray(v) || !v.length) throw issue(path, 'value_invalid');
    return exists(
      sql`${txt} in (${sql.join(
        v.map((x) => sql`${x}`),
        sql`, `,
      )})`,
    );
  }
  if (typeof v !== 'string') throw issue(path, 'value_invalid');
  if (c.op === 'contains') return exists(sql`${txt} ilike ${'%' + escapeLike(v) + '%'}`);
  if (c.op === 'neq') return sql`not ${exists(sql`${txt} = ${v}`)}`;
  return exists(sql`${txt} = ${v}`);
}

/** Remove everything referencing a deleted field / tag; report whether anything changed (02 §3). */
export function stripFromCriteria(
  criteria: Criteria,
  gone: { fieldId?: string; tagId?: string },
): { criteria: Criteria; changed: boolean } {
  let changed = false;
  const clauses: CriteriaClause[] = [];
  for (const c of criteria.clauses) {
    if (gone.fieldId && c.field === 'custom' && c.fieldId === gone.fieldId) {
      changed = true;
      continue;
    }
    if (gone.tagId && c.field === 'tag' && c.value.includes(gone.tagId)) {
      changed = true;
      const rest = c.value.filter((t) => t !== gone.tagId);
      if (rest.length) clauses.push({ ...c, value: rest });
      continue;
    }
    clauses.push(c);
  }
  return { criteria: { ...criteria, clauses }, changed };
}
