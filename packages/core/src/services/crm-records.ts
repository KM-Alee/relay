// Contacts, companies, opportunities: CRUD, owners, soft delete, optimistic locking (T-110, F2.1, Q4).
// Owner: Lane B. Every function: permission → scope (404 out of scope) → one transaction → audit /
// activity / realtime hint. Opportunity value only through core/auth/mask.ts.
import type { CompanyDto, ContactDto, Criteria, CrmEntity, OpportunityDto } from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { VALUE_PERMISSION, maskMoney } from '../auth/mask';
import { assertPermission, can } from '../auth/permissions';
import { AppError, forbidden, notFound, staleVersion } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import { recordActivity } from './crm-activity';
import { tagsService } from './crm-config';
import { compileCriteria, parseCriteria } from './crm-criteria';
import {
  ENTITY,
  assertActiveUser,
  assertCompanyExists,
  cursorSql,
  escapeLike,
  isUniqueViolation,
  isoReq,
  loadFieldValues,
  loadTags,
  one,
  pageOf,
  rows,
  saveFieldValues,
  scopeSql,
  uuidList,
  validationFailed,
  iso,
  type Row,
} from './crm-shared';

// ── Row shapes ───────────────────────────────────────────────────────────
interface ContactRow extends Row {
  id: string;
  name: string;
  phone_e164: string | null;
  email: string | null;
  company_id: string | null;
  company_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  language: 'en' | 'ur' | 'ur-Latn' | null;
  opted_out: boolean;
  last_activity_at: Date | null;
  ai_profile: Record<string, unknown>;
  version: number;
  created_at: Date;
}
interface CompanyRow extends Row {
  id: string;
  name: string;
  owner_user_id: string | null;
  owner_name: string | null;
  contact_count: number;
  version: number;
  created_at: Date;
}
interface OpportunityRow extends Row {
  id: string;
  contact_id: string;
  contact_name: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value_minor: string | number | null;
  currency: string;
  owner_user_id: string | null;
  owner_name: string | null;
  stage_entered_at: Date;
  closed_at: Date | null;
  version: number;
  created_at: Date;
}
type AnyRow = ContactRow | CompanyRow | OpportunityRow;

const FROM: Record<CrmEntity, { select: SQL; from: SQL }> = {
  contact: {
    select: sql`c.*, co.name as company_name, u.name as owner_name`,
    from: sql`contacts c left join companies co on co.workspace_id = c.workspace_id and co.id = c.company_id
              left join users u on u.workspace_id = c.workspace_id and u.id = c.owner_user_id`,
  },
  company: {
    select: sql`co.*, u.name as owner_name,
      (select count(*)::int from contacts x where x.workspace_id = co.workspace_id and x.company_id = co.id and x.deleted_at is null) as contact_count`,
    from: sql`companies co left join users u on u.workspace_id = co.workspace_id and u.id = co.owner_user_id`,
  },
  opportunity: {
    select: sql`o.*, c.name as contact_name, u.name as owner_name`,
    from: sql`opportunities o join contacts c on c.workspace_id = o.workspace_id and c.id = o.contact_id
              left join users u on u.workspace_id = o.workspace_id and u.id = o.owner_user_id`,
  },
};

export interface QueryOpts {
  q?: string;
  filter?: string | Criteria;
  cursor?: string;
  limit?: number;
  /** Restrict to these ids (detail lookups, board). */
  ids?: readonly string[];
  /** Extra AND-ed WHERE fragment on the entity aliases. */
  extra?: SQL;
  /** Skip record scope (only for echoing a just-written record back to its writer). */
  noScope?: boolean;
}

/** Build the shared WHERE (workspace, soft delete, scope, search, criteria). Used by lists, board, export. */
export async function buildWhere(
  tx: Tx,
  actor: Actor,
  entity: CrmEntity,
  opts: Pick<QueryOpts, 'q' | 'filter' | 'ids' | 'extra' | 'noScope'>,
): Promise<{ where: SQL; criteria: Criteria | null }> {
  const a = sql.raw(ENTITY[entity].alias);
  const parts: SQL[] = [sql`${a}.workspace_id = ${actor.workspaceId}::uuid`, sql`${a}.deleted_at is null`];
  if (!opts.noScope) parts.push(scopeSql(actor, entity));
  if (opts.ids) parts.push(sql`${a}.id in ${uuidList(opts.ids)}`);
  if (opts.q) {
    const like = `%${escapeLike(opts.q)}%`;
    parts.push(
      entity === 'contact'
        ? sql`(c.name ilike ${like} or c.phone_e164 like ${like} or c.email ilike ${like})`
        : entity === 'company'
          ? sql`co.name ilike ${like}`
          : sql`(o.title ilike ${like} or c.name ilike ${like})`,
    );
  }
  let criteria: Criteria | null = null;
  if (opts.filter !== undefined && opts.filter !== '') {
    criteria = typeof opts.filter === 'string' ? parseCriteria(opts.filter) : opts.filter;
    parts.push((await compileCriteria(tx, actor, entity, criteria)).where);
  }
  if (opts.extra) parts.push(opts.extra);
  return { where: sql.join(parts, sql` and `), criteria };
}

export async function queryRows(
  tx: Tx,
  actor: Actor,
  entity: CrmEntity,
  opts: QueryOpts,
): Promise<{ rows: AnyRow[]; nextCursor: string | null }> {
  const limit = opts.limit ?? 50;
  const { where } = await buildWhere(tx, actor, entity, opts);
  const f = FROM[entity];
  const rs = await rows<AnyRow>(
    tx,
    sql`select ${f.select} from ${f.from} where ${where} and ${cursorSql(ENTITY[entity].alias, opts.cursor)}
        order by ${sql.raw(ENTITY[entity].alias)}.id desc limit ${limit + 1}`,
  );
  const p = pageOf(rs, limit);
  return { rows: p.items, nextCursor: p.nextCursor };
}

export async function countRows(tx: Tx, actor: Actor, entity: CrmEntity, opts: QueryOpts): Promise<number> {
  const { where } = await buildWhere(tx, actor, entity, opts);
  const f = FROM[entity];
  const r = await one<{ n: number }>(tx, sql`select count(*)::int as n from ${f.from} where ${where}`);
  return r?.n ?? 0;
}

// ── DTO builders ─────────────────────────────────────────────────────────
export async function contactDtos(tx: Tx, rs: ContactRow[]): Promise<ContactDto[]> {
  const ids = rs.map((r) => r.id);
  const [tags, fields] = await Promise.all([
    loadTags(tx, 'contact', ids),
    loadFieldValues(tx, 'contact', ids),
  ]);
  return rs.map((r) => ({
    id: r.id,
    name: r.name,
    phoneE164: r.phone_e164,
    email: r.email,
    companyId: r.company_id,
    companyName: r.company_name,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    language: r.language,
    optedOut: r.opted_out,
    lastActivityAt: iso(r.last_activity_at),
    tags: tags.get(r.id) ?? [],
    fields: fields.get(r.id) ?? {},
    aiProfile: r.ai_profile ?? {},
    version: r.version,
    createdAt: isoReq(r.created_at),
  }));
}

export async function companyDtos(tx: Tx, rs: CompanyRow[]): Promise<CompanyDto[]> {
  const fields = await loadFieldValues(
    tx,
    'company',
    rs.map((r) => r.id),
  );
  return rs.map((r) => ({
    id: r.id,
    name: r.name,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    contactCount: r.contact_count,
    fields: fields.get(r.id) ?? {},
    version: r.version,
    createdAt: isoReq(r.created_at),
  }));
}

/** Opportunity value → `maskMoney` (core/auth/mask.ts): the ONLY path a value reaches a response. */
export async function opportunityDtos(tx: Tx, actor: Actor, rs: OpportunityRow[]): Promise<OpportunityDto[]> {
  const ids = rs.map((r) => r.id);
  const [tags, fields] = await Promise.all([
    loadTags(tx, 'opportunity', ids),
    loadFieldValues(tx, 'opportunity', ids),
  ]);
  return rs.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    pipelineId: r.pipeline_id,
    stageId: r.stage_id,
    title: r.title,
    value: maskMoney(actor, r.value_minor === null ? null : Number(r.value_minor), r.currency),
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    stageEnteredAt: isoReq(r.stage_entered_at),
    closedAt: iso(r.closed_at),
    tags: tags.get(r.id) ?? [],
    fields: fields.get(r.id) ?? {},
    version: r.version,
    createdAt: isoReq(r.created_at),
  }));
}

/** DTOs for any entity (saved lists, export, 360). */
type DtoMap = { contact: ContactDto; company: CompanyDto; opportunity: OpportunityDto };
export async function dtosFor<E extends CrmEntity>(
  tx: Tx,
  actor: Actor,
  entity: E,
  rs: AnyRow[],
): Promise<DtoMap[E][]> {
  if (entity === 'contact') return (await contactDtos(tx, rs as ContactRow[])) as DtoMap[E][];
  if (entity === 'company') return (await companyDtos(tx, rs as CompanyRow[])) as DtoMap[E][];
  return (await opportunityDtos(tx, actor, rs as OpportunityRow[])) as DtoMap[E][];
}

async function dtoById<E extends CrmEntity>(tx: Tx, actor: Actor, entity: E, id: string): Promise<DtoMap[E]> {
  const r = await queryRows(tx, actor, entity, { ids: [id], limit: 1, noScope: true });
  if (!r.rows[0]) throw notFound();
  return (await dtosFor(tx, actor, entity, r.rows))[0]!;
}

// ── Locking helper ───────────────────────────────────────────────────────
/** SELECT … FOR UPDATE inside scope (404 when absent, soft-deleted, other workspace or out of scope). */
async function lock<T extends Row>(tx: Tx, actor: Actor, entity: CrmEntity, id: string): Promise<T> {
  const m = ENTITY[entity];
  const a = sql.raw(m.alias);
  const r = await one<T>(
    tx,
    sql`select ${a}.* from ${sql.raw(m.table)} ${a} where ${a}.workspace_id = ${actor.workspaceId}::uuid
        and ${a}.id = ${id}::uuid and ${a}.deleted_at is null and ${scopeSql(actor, entity)} for update of ${a}`,
  );
  if (!r) throw notFound();
  return r;
}

async function checkVersion(
  tx: Tx,
  actor: Actor,
  entity: CrmEntity,
  id: string,
  current: number,
  sent: number,
) {
  if (current !== sent) throw staleVersion(await dtoById(tx, actor, entity, id));
}

function assertValueAllowed(actor: Actor) {
  if (!can(actor, VALUE_PERMISSION)) throw forbidden({ permission: VALUE_PERMISSION });
}

const uniqueToConflict = (e: unknown): never => {
  if (isUniqueViolation(e, 'phone')) throw new AppError('CONFLICT', { details: { field: 'phone' } });
  if (isUniqueViolation(e, 'email')) throw new AppError('CONFLICT', { details: { field: 'email' } });
  throw e;
};

const hint = (tx: Tx, actor: Actor, entity: CrmEntity, id: string) =>
  emit(tx, { workspaceId: actor.workspaceId, topic: ENTITY[entity].realtime, ids: [id] });

type Changes = { key: string; from?: unknown; to?: unknown }[];

// ── Contacts ─────────────────────────────────────────────────────────────
export interface ContactInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  language?: 'en' | 'ur' | 'ur-Latn' | null;
  fields?: Record<string, string | number | boolean | null>;
  version?: number;
}

export const contactsService = {
  /** GET /contacts (crm.contact.view): scoped, searchable, filterable, keyset-paginated. */
  async list(
    actor: Actor,
    query: { cursor?: string; limit?: number; q?: string; filter?: string; companyId?: string },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.contact.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const extra = query.companyId ? sql`c.company_id = ${query.companyId}::uuid` : undefined;
        const r = await queryRows(tx, actor, 'contact', { ...query, extra });
        return { items: await contactDtos(tx, r.rows as ContactRow[]), nextCursor: r.nextCursor };
      },
      opts,
    );
  },

  async get(actor: Actor, id: string, opts: TxOptions = {}): Promise<ContactDto> {
    assertPermission(actor, 'crm.contact.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await queryRows(tx, actor, 'contact', { ids: [id], limit: 1 });
        if (!r.rows[0]) throw notFound();
        return (await contactDtos(tx, r.rows as ContactRow[]))[0]!;
      },
      opts,
    );
  },

  /** POST /contacts (crm.contact.create). Owner defaults to the creator. */
  async create(
    actor: Actor,
    input: ContactInput & { name: string },
    opts: TxOptions = {},
  ): Promise<ContactDto> {
    assertPermission(actor, 'crm.contact.create');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const owner = input.ownerUserId === undefined ? actor.userId : input.ownerUserId;
        if (owner) await assertActiveUser(tx, actor.workspaceId, owner);
        if (input.companyId) await assertCompanyExists(tx, actor.workspaceId, input.companyId);
        const id = uuidv7();
        try {
          await tx.execute(
            sql`insert into contacts (id, workspace_id, company_id, name, phone_e164, email, owner_user_id, language)
                values (${id}::uuid, ${actor.workspaceId}::uuid, ${input.companyId ?? null}::uuid, ${input.name},
                        ${input.phone ?? null}, ${input.email ?? null}, ${owner}::uuid, ${input.language ?? null})`,
          );
        } catch (e) {
          uniqueToConflict(e);
        }
        if (input.fields) await saveFieldValues(tx, actor, 'contact', id, input.fields);
        await recordActivity(tx, actor, {
          contactId: id,
          type: 'system',
          payload: { event: 'contact_created' },
        });
        await hint(tx, actor, 'contact', id);
        return dtoById(tx, actor, 'contact', id);
      },
      opts,
    );
  },

  /** PATCH /contacts/:id (crm.contact.edit). Stale `version` → 409 STALE_VERSION with `current`. */
  async update(
    actor: Actor,
    id: string,
    input: ContactInput & { version: number },
    opts: TxOptions = {},
  ): Promise<ContactDto> {
    assertPermission(actor, 'crm.contact.edit');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lock<ContactRow>(tx, actor, 'contact', id);
        await checkVersion(tx, actor, 'contact', id, cur.version, input.version);
        const sets: SQL[] = [];
        const changes: Changes = [];
        const set = (col: string, key: string, next: unknown, prev: unknown) => {
          if (next === undefined || next === prev) return;
          sets.push(sql`${sql.raw(col)} = ${next}`);
          changes.push({ key, from: prev, to: next });
        };
        set('name', 'name', input.name, cur.name);
        set('phone_e164', 'phone', input.phone, cur.phone_e164);
        set('email', 'email', input.email, cur.email);
        set('language', 'language', input.language, cur.language);
        if (input.companyId !== undefined && input.companyId !== cur.company_id) {
          if (input.companyId) await assertCompanyExists(tx, actor.workspaceId, input.companyId);
          sets.push(sql`company_id = ${input.companyId}::uuid`);
          changes.push({ key: 'company', from: cur.company_id, to: input.companyId });
        }
        const ownerChanged = input.ownerUserId !== undefined && input.ownerUserId !== cur.owner_user_id;
        if (ownerChanged) {
          if (input.ownerUserId) await assertActiveUser(tx, actor.workspaceId, input.ownerUserId);
          sets.push(sql`owner_user_id = ${input.ownerUserId}::uuid`);
        }
        try {
          await tx.execute(
            sql`update contacts set ${sql.join([...sets, sql`version = version + 1`], sql`, `)}
                where id = ${id}::uuid and version = ${input.version}`,
          );
        } catch (e) {
          uniqueToConflict(e);
        }
        const fieldChanges = input.fields
          ? await saveFieldValues(tx, actor, 'contact', id, input.fields)
          : [];
        const all: Changes = [
          ...changes,
          ...fieldChanges.map((f) => ({ key: f.key, from: f.from, to: f.to })),
        ];
        if (all.length)
          await recordActivity(tx, actor, { contactId: id, type: 'field_edit', payload: { changes: all } });
        if (ownerChanged) {
          await recordActivity(tx, actor, {
            contactId: id,
            type: 'assignment',
            payload: { fromUserId: cur.owner_user_id, toUserId: input.ownerUserId ?? null },
          });
          await auditAppend(tx, actor, {
            action: 'contact.owner_changed',
            targetType: 'contact',
            targetId: id,
            before: { ownerUserId: cur.owner_user_id },
            after: { ownerUserId: input.ownerUserId ?? null },
          });
        }
        await hint(tx, actor, 'contact', id);
        return dtoById(tx, actor, 'contact', id);
      },
      opts,
    );
  },

  /** DELETE /contacts/:id (crm.contact.delete): soft delete; its opportunities go with it. Audited. */
  async remove(actor: Actor, id: string, opts: TxOptions = {}): Promise<{ ok: true }> {
    assertPermission(actor, 'crm.contact.delete');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lock<ContactRow>(tx, actor, 'contact', id);
        await tx.execute(
          sql`update contacts set deleted_at = now(), version = version + 1 where id = ${id}::uuid`,
        );
        await tx.execute(
          sql`update opportunities set deleted_at = now(), version = version + 1 where contact_id = ${id}::uuid and deleted_at is null`,
        );
        await auditAppend(tx, actor, {
          action: 'contact.deleted',
          targetType: 'contact',
          targetId: id,
          before: { name: cur.name },
        });
        await hint(tx, actor, 'contact', id);
        return { ok: true as const };
      },
      opts,
    );
  },

  /** POST/DELETE /contacts/:id/tags: attach or detach a tag; returns the refreshed contact. */
  async tag(
    actor: Actor,
    id: string,
    tagId: string,
    attach: boolean,
    opts: TxOptions = {},
  ): Promise<ContactDto> {
    await tagsService.setOnRecord(actor, 'contact', id, tagId, attach, opts);
    return contactsService.get(actor, id, opts);
  },
};

// ── Companies ────────────────────────────────────────────────────────────
export const companiesService = {
  async list(
    actor: Actor,
    query: { cursor?: string; limit?: number; q?: string; filter?: string },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.company.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await queryRows(tx, actor, 'company', query);
        return { items: await companyDtos(tx, r.rows as CompanyRow[]), nextCursor: r.nextCursor };
      },
      opts,
    );
  },

  async get(actor: Actor, id: string, opts: TxOptions = {}): Promise<CompanyDto> {
    assertPermission(actor, 'crm.company.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await queryRows(tx, actor, 'company', { ids: [id], limit: 1 });
        if (!r.rows[0]) throw notFound();
        return (await companyDtos(tx, r.rows as CompanyRow[]))[0]!;
      },
      opts,
    );
  },

  async create(
    actor: Actor,
    input: {
      name: string;
      ownerUserId?: string | null;
      fields?: Record<string, string | number | boolean | null>;
    },
    opts: TxOptions = {},
  ): Promise<CompanyDto> {
    assertPermission(actor, 'crm.company.create');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const owner = input.ownerUserId === undefined ? actor.userId : input.ownerUserId;
        if (owner) await assertActiveUser(tx, actor.workspaceId, owner);
        const id = uuidv7();
        await tx.execute(
          sql`insert into companies (id, workspace_id, name, owner_user_id)
              values (${id}::uuid, ${actor.workspaceId}::uuid, ${input.name}, ${owner}::uuid)`,
        );
        if (input.fields) await saveFieldValues(tx, actor, 'company', id, input.fields);
        await hint(tx, actor, 'company', id);
        return dtoById(tx, actor, 'company', id);
      },
      opts,
    );
  },

  async update(
    actor: Actor,
    id: string,
    input: {
      name?: string;
      ownerUserId?: string | null;
      fields?: Record<string, string | number | boolean | null>;
      version: number;
    },
    opts: TxOptions = {},
  ): Promise<CompanyDto> {
    assertPermission(actor, 'crm.company.edit');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lock<CompanyRow>(tx, actor, 'company', id);
        await checkVersion(tx, actor, 'company', id, cur.version, input.version);
        const sets: SQL[] = [];
        if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
        const ownerChanged = input.ownerUserId !== undefined && input.ownerUserId !== cur.owner_user_id;
        if (ownerChanged) {
          if (input.ownerUserId) await assertActiveUser(tx, actor.workspaceId, input.ownerUserId);
          sets.push(sql`owner_user_id = ${input.ownerUserId}::uuid`);
        }
        await tx.execute(
          sql`update companies set ${sql.join([...sets, sql`version = version + 1`], sql`, `)}
              where id = ${id}::uuid and version = ${input.version}`,
        );
        if (input.fields) await saveFieldValues(tx, actor, 'company', id, input.fields);
        if (ownerChanged)
          await auditAppend(tx, actor, {
            action: 'company.owner_changed',
            targetType: 'company',
            targetId: id,
            before: { ownerUserId: cur.owner_user_id },
            after: { ownerUserId: input.ownerUserId ?? null },
          });
        await hint(tx, actor, 'company', id);
        return dtoById(tx, actor, 'company', id);
      },
      opts,
    );
  },

  /** DELETE /companies/:id (crm.company.delete): soft delete; its contacts are unlinked, not deleted. */
  async remove(actor: Actor, id: string, opts: TxOptions = {}): Promise<{ ok: true }> {
    assertPermission(actor, 'crm.company.delete');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lock<CompanyRow>(tx, actor, 'company', id);
        await tx.execute(
          sql`update companies set deleted_at = now(), version = version + 1 where id = ${id}::uuid`,
        );
        await tx.execute(sql`update contacts set company_id = null where company_id = ${id}::uuid`);
        await auditAppend(tx, actor, {
          action: 'company.deleted',
          targetType: 'company',
          targetId: id,
          before: { name: cur.name },
        });
        await hint(tx, actor, 'company', id);
        return { ok: true as const };
      },
      opts,
    );
  },
};

// ── Opportunities ────────────────────────────────────────────────────────
export interface OpportunityInput {
  title?: string;
  valueMinor?: number | null;
  currency?: string;
  ownerUserId?: string | null;
  fields?: Record<string, string | number | boolean | null>;
  version?: number;
}

export const opportunitiesService = {
  async list(
    actor: Actor,
    query: {
      cursor?: string;
      limit?: number;
      q?: string;
      filter?: string;
      pipelineId?: string;
      stageId?: string;
      contactId?: string;
    },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.opportunity.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const extra = [
          query.pipelineId ? sql`o.pipeline_id = ${query.pipelineId}::uuid` : null,
          query.stageId ? sql`o.stage_id = ${query.stageId}::uuid` : null,
          query.contactId ? sql`o.contact_id = ${query.contactId}::uuid` : null,
        ].filter((x): x is SQL => x !== null);
        const r = await queryRows(tx, actor, 'opportunity', {
          ...query,
          extra: extra.length ? sql.join(extra, sql` and `) : undefined,
        });
        return {
          items: await opportunityDtos(tx, actor, r.rows as OpportunityRow[]),
          nextCursor: r.nextCursor,
        };
      },
      opts,
    );
  },

  async get(actor: Actor, id: string, opts: TxOptions = {}): Promise<OpportunityDto> {
    assertPermission(actor, 'crm.opportunity.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await queryRows(tx, actor, 'opportunity', { ids: [id], limit: 1 });
        if (!r.rows[0]) throw notFound();
        return (await opportunityDtos(tx, actor, r.rows as OpportunityRow[]))[0]!;
      },
      opts,
    );
  },

  /** POST /opportunities (crm.opportunity.create). Pipeline/stage default to the default pipeline's first stage. */
  async create(
    actor: Actor,
    input: OpportunityInput & { title: string; contactId: string; pipelineId?: string; stageId?: string },
    opts: TxOptions = {},
  ): Promise<OpportunityDto> {
    assertPermission(actor, 'crm.opportunity.create');
    if (input.valueMinor !== undefined) assertValueAllowed(actor);
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const contact = await one<{ id: string }>(
          tx,
          sql`select c.id from contacts c where c.workspace_id = ${actor.workspaceId}::uuid and c.id = ${input.contactId}::uuid
              and c.deleted_at is null and ${scopeSql(actor, 'contact')}`,
        );
        if (!contact) throw notFound();
        let stage: { id: string; pipeline_id: string; kind: string } | null;
        if (input.stageId) {
          stage = await one(
            tx,
            sql`select id, pipeline_id, kind from stages where id = ${input.stageId}::uuid`,
          );
          if (!stage || (input.pipelineId && stage.pipeline_id !== input.pipelineId))
            throw validationFailed('stageId', 'stage_not_found');
        } else {
          stage = await one(
            tx,
            sql`select s.id, s.pipeline_id, s.kind from stages s join pipelines p on p.workspace_id = s.workspace_id and p.id = s.pipeline_id
                where ${input.pipelineId ? sql`p.id = ${input.pipelineId}::uuid` : sql`p.is_default`}
                order by s.position limit 1`,
          );
          if (!stage) throw validationFailed('pipelineId', 'pipeline_not_found');
        }
        const owner = input.ownerUserId === undefined ? actor.userId : input.ownerUserId;
        if (owner) await assertActiveUser(tx, actor.workspaceId, owner);
        const ws = await one<{ currency: string }>(
          tx,
          sql`select currency from workspaces where id = ${actor.workspaceId}::uuid`,
        );
        const id = uuidv7();
        await tx.execute(
          sql`insert into opportunities (id, workspace_id, contact_id, pipeline_id, stage_id, title, value_minor, currency, owner_user_id, closed_at)
              values (${id}::uuid, ${actor.workspaceId}::uuid, ${input.contactId}::uuid, ${stage.pipeline_id}::uuid, ${stage.id}::uuid,
                      ${input.title}, ${input.valueMinor ?? null}, ${input.currency ?? ws?.currency ?? 'PKR'}, ${owner}::uuid,
                      ${stage.kind === 'open' ? null : sql`now()`})`,
        );
        if (input.fields)
          await saveFieldValues(tx, actor, 'opportunity', id, input.fields, {
            pipelineId: stage.pipeline_id,
          });
        await recordActivity(tx, actor, {
          contactId: input.contactId,
          opportunityId: id,
          type: 'system',
          payload: { event: 'opportunity_created', title: input.title },
        });
        await hint(tx, actor, 'opportunity', id);
        return dtoById(tx, actor, 'opportunity', id);
      },
      opts,
    );
  },

  async update(
    actor: Actor,
    id: string,
    input: OpportunityInput & { version: number },
    opts: TxOptions = {},
  ): Promise<OpportunityDto> {
    assertPermission(actor, 'crm.opportunity.edit');
    if (input.valueMinor !== undefined) assertValueAllowed(actor);
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lock<OpportunityRow>(tx, actor, 'opportunity', id);
        await checkVersion(tx, actor, 'opportunity', id, cur.version, input.version);
        const sets: SQL[] = [];
        const changes: Changes = [];
        if (input.title !== undefined && input.title !== cur.title) {
          sets.push(sql`title = ${input.title}`);
          changes.push({ key: 'title', from: cur.title, to: input.title });
        }
        if (input.valueMinor !== undefined) {
          sets.push(sql`value_minor = ${input.valueMinor}`);
          changes.push({ key: 'value' }); // never the amount: the timeline is not value-masked per viewer
        }
        if (input.currency) sets.push(sql`currency = ${input.currency}`);
        const ownerChanged = input.ownerUserId !== undefined && input.ownerUserId !== cur.owner_user_id;
        if (ownerChanged) {
          if (input.ownerUserId) await assertActiveUser(tx, actor.workspaceId, input.ownerUserId);
          sets.push(sql`owner_user_id = ${input.ownerUserId}::uuid`);
        }
        await tx.execute(
          sql`update opportunities set ${sql.join([...sets, sql`version = version + 1`], sql`, `)}
              where id = ${id}::uuid and version = ${input.version}`,
        );
        const fieldChanges = input.fields
          ? await saveFieldValues(tx, actor, 'opportunity', id, input.fields, { pipelineId: cur.pipeline_id })
          : [];
        const all: Changes = [
          ...changes,
          ...fieldChanges.map((f) => ({ key: f.key, from: f.from, to: f.to })),
        ];
        if (all.length)
          await recordActivity(tx, actor, {
            contactId: cur.contact_id,
            opportunityId: id,
            type: 'field_edit',
            payload: { changes: all },
          });
        if (ownerChanged) {
          await recordActivity(tx, actor, {
            contactId: cur.contact_id,
            opportunityId: id,
            type: 'assignment',
            payload: { fromUserId: cur.owner_user_id, toUserId: input.ownerUserId ?? null },
          });
          await auditAppend(tx, actor, {
            action: 'opportunity.owner_changed',
            targetType: 'opportunity',
            targetId: id,
            before: { ownerUserId: cur.owner_user_id },
            after: { ownerUserId: input.ownerUserId ?? null },
          });
        }
        await hint(tx, actor, 'opportunity', id);
        return dtoById(tx, actor, 'opportunity', id);
      },
      opts,
    );
  },

  async remove(actor: Actor, id: string, opts: TxOptions = {}): Promise<{ ok: true }> {
    assertPermission(actor, 'crm.opportunity.delete');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await lock<OpportunityRow>(tx, actor, 'opportunity', id);
        await tx.execute(
          sql`update opportunities set deleted_at = now(), version = version + 1 where id = ${id}::uuid`,
        );
        await auditAppend(tx, actor, {
          action: 'opportunity.deleted',
          targetType: 'opportunity',
          targetId: id,
          before: { title: cur.title }, // value deliberately omitted (F1.4)
        });
        await hint(tx, actor, 'opportunity', id);
        return { ok: true as const };
      },
      opts,
    );
  },

  async tag(
    actor: Actor,
    id: string,
    tagId: string,
    attach: boolean,
    opts: TxOptions = {},
  ): Promise<OpportunityDto> {
    await tagsService.setOnRecord(actor, 'opportunity', id, tagId, attach, opts);
    return opportunitiesService.get(actor, id, opts);
  },
};

export {
  lock as lockRecord,
  checkVersion,
  dtoById,
  hint as emitRecordHint,
  type OpportunityRow,
  type ContactRow,
  type CompanyRow,
};
