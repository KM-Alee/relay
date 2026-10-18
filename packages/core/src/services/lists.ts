// Saved lists (T-115, F2.6, Q9). Owner: Lane B. A list stores only its criteria: membership is evaluated
// at query time with the VIEWER's record scope and masking, so it is always live and never leaks.
import { criteriaSchema, type CrmEntity, type Criteria, type SavedListDto } from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { assertPermission, can, type PermissionKey } from '../auth/permissions';
import { forbidden, notFound, staleVersion } from '../errors';
import { uuidv7 } from '../ids';
import { compileCriteria, usesValue } from './crm-criteria';
import { countRows, dtosFor, queryRows } from './crm-records';
import { ENTITY, one, rows } from './crm-shared';

interface ListRow {
  id: string;
  owner_user_id: string;
  name: string;
  entity: CrmEntity;
  criteria: unknown;
  is_shared: boolean;
  needs_review: boolean;
  version: number;
}

const toDto = (r: ListRow): SavedListDto => ({
  id: r.id,
  name: r.name,
  entity: r.entity,
  criteria: criteriaSchema.parse(r.criteria),
  isShared: r.is_shared,
  needsReview: r.needs_review,
  ownerUserId: r.owner_user_id,
  version: r.version,
});

const viewKey = (e: CrmEntity) => ENTITY[e].view as PermissionKey;

async function visibleList(tx: Tx, actor: Actor, id: string): Promise<ListRow> {
  const r = await one<ListRow>(
    tx,
    sql`select * from saved_lists where id = ${id}::uuid and workspace_id = ${actor.workspaceId}::uuid
        and (owner_user_id = ${actor.userId}::uuid or is_shared)`,
  );
  if (!r || !can(actor, viewKey(r.entity))) throw notFound();
  return r;
}

function assertCanEdit(actor: Actor, l: ListRow) {
  if (l.owner_user_id !== actor.userId && !can(actor, 'crm.config.manage')) throw forbidden();
}

export const listsService = {
  /** GET /saved-lists: own lists + shared ones, for entities the caller may view. */
  async list(actor: Actor, opts: TxOptions = {}) {
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const rs = await rows<ListRow>(
          tx,
          sql`select * from saved_lists where workspace_id = ${actor.workspaceId}::uuid
              and (owner_user_id = ${actor.userId}::uuid or is_shared) order by lower(name), id`,
        );
        return { items: rs.filter((r) => can(actor, viewKey(r.entity))).map(toDto) };
      },
      opts,
    );
  },

  /** POST /saved-lists: criteria are validated against the entity and the caller's permissions (Q9). */
  async create(
    actor: Actor,
    input: { name: string; entity: CrmEntity; criteria: Criteria; isShared: boolean },
    opts: TxOptions = {},
  ): Promise<SavedListDto> {
    assertPermission(actor, viewKey(input.entity));
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        await compileCriteria(tx, actor, input.entity, input.criteria);
        const id = uuidv7();
        await tx.execute(
          sql`insert into saved_lists (id, workspace_id, owner_user_id, name, entity, criteria, is_shared)
              values (${id}::uuid, ${actor.workspaceId}::uuid, ${actor.userId}::uuid, ${input.name}, ${input.entity},
                      ${JSON.stringify(input.criteria)}::jsonb, ${input.isShared})`,
        );
        return toDto((await one<ListRow>(tx, sql`select * from saved_lists where id = ${id}::uuid`))!);
      },
      opts,
    );
  },

  async update(
    actor: Actor,
    id: string,
    input: { name?: string; criteria?: Criteria; isShared?: boolean; version: number },
    opts: TxOptions = {},
  ): Promise<SavedListDto> {
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await visibleList(tx, actor, id);
        assertCanEdit(actor, cur);
        await tx.execute(sql`select 1 from saved_lists where id = ${id}::uuid for update`);
        const fresh = (await one<ListRow>(tx, sql`select * from saved_lists where id = ${id}::uuid`))!;
        if (fresh.version !== input.version) throw staleVersion(toDto(fresh));
        if (input.criteria) await compileCriteria(tx, actor, cur.entity, input.criteria);
        await tx.execute(
          sql`update saved_lists set name = ${input.name ?? cur.name},
                criteria = ${JSON.stringify(input.criteria ?? cur.criteria)}::jsonb,
                is_shared = ${input.isShared ?? cur.is_shared},
                needs_review = ${input.criteria ? false : cur.needs_review}, version = version + 1
              where id = ${id}::uuid and version = ${input.version}`,
        );
        return toDto((await one<ListRow>(tx, sql`select * from saved_lists where id = ${id}::uuid`))!);
      },
      opts,
    );
  },

  async remove(actor: Actor, id: string, opts: TxOptions = {}) {
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const cur = await visibleList(tx, actor, id);
        assertCanEdit(actor, cur);
        await tx.execute(sql`delete from saved_lists where id = ${id}::uuid`);
        return { ok: true as const };
      },
      opts,
    );
  },

  /** GET /saved-lists/:id/items: LIVE evaluation with the viewer's scope + masking. */
  async items(actor: Actor, id: string, query: { cursor?: string; limit?: number }, opts: TxOptions = {}) {
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const l = await visibleList(tx, actor, id);
        const criteria = criteriaSchema.parse(l.criteria);
        // A viewer who may not see values must not learn them through list membership either.
        if (usesValue(criteria) && !can(actor, 'crm.opportunity.value.view'))
          throw forbidden({ field: 'value' });
        const r = await queryRows(tx, actor, l.entity, {
          filter: criteria,
          cursor: query.cursor,
          limit: query.limit,
        });
        const total = await countRows(tx, actor, l.entity, { filter: criteria });
        return {
          entity: l.entity,
          total,
          items: await dtosFor(tx, actor, l.entity, r.rows),
          nextCursor: r.nextCursor,
        };
      },
      opts,
    );
  },
};
