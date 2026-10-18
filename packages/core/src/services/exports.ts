// CSV export (T-118, F2.11, F1.4). Owner: Lane B.
// crm.export + the entity's view permission; SAME record scope as the UI; opportunity value only via
// core/auth/mask.ts (masked cell for users without the value permission); formula-injection guard on every
// cell (06 §7); audited with actor, scope and row count in the same transaction.
import {
  criteriaSchema,
  type CompanyDto,
  type ContactDto,
  type CrmEntity,
  type Criteria,
  type CustomFieldDto,
  type OpportunityDto,
} from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission, can, type PermissionKey } from '../auth/permissions';
import { forbidden, notFound } from '../errors';
import { usesValue } from './crm-criteria';
import { dtosFor, queryRows } from './crm-records';
import { ENTITY, iso, one, rows } from './crm-shared';

export const EXPORT_ROW_CAP = 50_000;
const BATCH = 500;

/** Neutralise spreadsheet formulas: cells starting with = + - @ TAB CR get a leading apostrophe. */
export function neutralizeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** RFC 4180 field: neutralised, then quoted when it contains , " CR or LF. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = neutralizeCell(String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsvLine = (cells: unknown[]): string => cells.map(csvCell).join(',') + '\r\n';

const MASKED_CELL = '[masked]';

function moneyCell(v: OpportunityDto['value']): string {
  if (!v) return '';
  return v.masked ? MASKED_CELL : String(v.amountMinor / 100);
}

function fieldCell(f: CustomFieldDto, values: Record<string, string | number | boolean>): unknown {
  const v = values[f.id];
  if (v === undefined) return '';
  if (f.type === 'dropdown') return f.options.find((o) => o.value === v)?.label.en ?? v;
  if (f.type === 'checkbox') return v ? 'yes' : 'no';
  return v;
}

function header(entity: CrmEntity, fields: CustomFieldDto[]): string[] {
  const base =
    entity === 'contact'
      ? ['id', 'name', 'phone', 'email', 'company', 'owner', 'language', 'opted_out', 'tags', 'created_at']
      : entity === 'company'
        ? ['id', 'name', 'owner', 'contacts', 'created_at']
        : [
            'id',
            'title',
            'contact',
            'stage',
            'value',
            'currency',
            'owner',
            'tags',
            'closed_at',
            'created_at',
          ];
  return [...base, ...fields.map((f) => f.label.en)];
}

function line(
  entity: CrmEntity,
  d: ContactDto | CompanyDto | OpportunityDto,
  fields: CustomFieldDto[],
  stageNames: Map<string, string>,
): unknown[] {
  const custom = fields.map((f) => fieldCell(f, d.fields));
  if (entity === 'contact') {
    const c = d as ContactDto;
    return [
      c.id,
      c.name,
      c.phoneE164,
      c.email,
      c.companyName,
      c.ownerName,
      c.language,
      c.optedOut,
      c.tags.map((t) => t.name).join('; '),
      c.createdAt,
      ...custom,
    ];
  }
  if (entity === 'company') {
    const c = d as CompanyDto;
    return [c.id, c.name, c.ownerName, c.contactCount, c.createdAt, ...custom];
  }
  const o = d as OpportunityDto;
  const currency = o.value && !o.value.masked ? o.value.currency : '';
  return [
    o.id,
    o.title,
    o.contactName,
    stageNames.get(o.stageId),
    moneyCell(o.value),
    currency,
    o.ownerName,
    o.tags.map((t) => t.name).join('; '),
    o.closedAt,
    o.createdAt,
    ...custom,
  ];
}

export interface ExportResult {
  filename: string;
  csv: string;
  rowCount: number;
}

async function exportIn(
  tx: Tx,
  actor: Actor,
  input: { entity?: CrmEntity; savedListId?: string; filter?: string },
): Promise<ExportResult & { entity: CrmEntity; scope: Record<string, unknown> }> {
  let entity = input.entity;
  let filter: string | Criteria | undefined = input.filter;
  if (input.savedListId) {
    const l = await one<{ entity: CrmEntity; criteria: unknown }>(
      tx,
      sql`select entity, criteria from saved_lists where id = ${input.savedListId}::uuid and (owner_user_id = ${actor.userId}::uuid or is_shared)`,
    );
    if (!l) throw notFound();
    entity = l.entity;
    filter = criteriaSchema.parse(l.criteria);
  }
  if (!entity) throw notFound();
  assertPermission(actor, ENTITY[entity].view as PermissionKey);
  if (typeof filter === 'object' && usesValue(filter) && !can(actor, 'crm.opportunity.value.view'))
    throw forbidden({ field: 'value' });

  const fields = (
    await rows<{
      id: string;
      entity: CrmEntity;
      pipeline_id: string | null;
      key: string;
      label: { en: string; ur: string };
      type: CustomFieldDto['type'];
      options: CustomFieldDto['options'];
      position: number;
      version: number;
    }>(tx, sql`select * from custom_fields where entity = ${entity} order by position, key`)
  ).map<CustomFieldDto>((f) => ({
    id: f.id,
    entity: f.entity,
    pipelineId: f.pipeline_id,
    key: f.key,
    label: f.label,
    type: f.type,
    options: f.options,
    position: f.position,
    version: f.version,
  }));
  const stageNames = new Map(
    (await rows<{ id: string; name: string }>(tx, sql`select id, name from stages`)).map((s) => [
      s.id,
      s.name,
    ]),
  );

  let csv = '﻿' + toCsvLine(header(entity, fields));
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await queryRows(tx, actor, entity, { filter, cursor, limit: BATCH });
    for (const d of await dtosFor(tx, actor, entity, page.rows)) {
      if (count >= EXPORT_ROW_CAP) break;
      csv += toCsvLine(line(entity, d, fields, stageNames));
      count++;
    }
    cursor = count >= EXPORT_ROW_CAP ? undefined : (page.nextCursor ?? undefined);
  } while (cursor);

  const day = (iso(new Date()) ?? '').slice(0, 10);
  return {
    entity,
    csv,
    rowCount: count,
    filename: `relay-${entity}s-${day}.csv`,
    scope: {
      entity,
      savedListId: input.savedListId ?? null,
      filtered: Boolean(filter),
      recordScope: can(actor, 'leads.view_all') ? 'all' : 'own',
      valuesMasked: entity === 'opportunity' ? !can(actor, 'crm.opportunity.value.view') : false,
    },
  };
}

export const exportsService = {
  /** POST /exports (crm.export): builds the CSV and writes the audit row in ONE transaction. */
  async create(
    actor: Actor,
    input: { entity?: CrmEntity; savedListId?: string; filter?: string },
    opts: TxOptions = {},
  ): Promise<ExportResult> {
    assertPermission(actor, 'crm.export');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await exportIn(tx, actor, input);
        await auditAppend(tx, actor, {
          action: 'crm.exported',
          targetType: r.entity,
          targetId: input.savedListId ?? null,
          meta: { ...r.scope, rowCount: r.rowCount },
        });
        return { filename: r.filename, csv: r.csv, rowCount: r.rowCount };
      },
      opts,
    );
  },
};
