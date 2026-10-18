// Activity timeline, notes, call logs (T-116, F2.7, F2.13) + the human-action hook for auto-ack.
// Owner: Lane B.
import type { ActivityDto, ActivityType } from '@relay/contracts/api/crm';
import { activityDto } from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { AuditActor } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { maskValueFields } from '../auth/mask';
import { notFound } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import { cursorSql, isoReq, one, pageOf, rows, scopeSql, userNames } from './crm-shared';

// ── onHumanAction: the seam Lane A connects to owner-action auto-ack (F2.13, 03 §3, T-123) ────────────
export interface HumanActionInput {
  /** The lead the action relates to, when known. Otherwise resolve by `contactId` (≤ 1 open lead per contact). */
  leadId?: string | null;
  contactId: string;
  /** The human who acted. The hook implementation must check they own the lead before acknowledging. */
  actor: Actor;
}
export type HumanActionHandler = (tx: Tx, input: HumanActionInput) => Promise<void>;

const handlers: HumanActionHandler[] = [];
/** Lane A: `registerHumanActionHandler(leadsService.acknowledgeOnHumanAction)` at module load, or edit the body below. */
export function registerHumanActionHandler(h: HumanActionHandler): void {
  handlers.push(h);
}
/**
 * Called inside the SAME transaction as every human CRM action that counts as an acknowledgement action
 * (note, call log, stage change, field edit, contact/opportunity edit). Runs registered handlers in order;
 * a no-op until Lane A connects it. Never called for system/AI actors.
 */
export async function onHumanAction(tx: Tx, input: HumanActionInput): Promise<void> {
  for (const h of handlers) await h(tx, input);
}

const HUMAN_TYPES: ReadonlySet<ActivityType> = new Set(['note', 'call', 'stage_change', 'field_edit']);

export interface RecordActivityInput {
  contactId?: string | null;
  opportunityId?: string | null;
  leadId?: string | null;
  type: ActivityType;
  payload?: Record<string, unknown>;
  /** AI-authored entries are labelled; they never count as human action. */
  actorType?: 'user' | 'system' | 'ai';
}

/** Insert one timeline entry, bump last_activity_at, and fire onHumanAction for human actors. */
export async function recordActivity(tx: Tx, actor: AuditActor, input: RecordActivityInput): Promise<string> {
  const id = uuidv7();
  const isUser = !('type' in actor);
  const actorType = isUser ? 'user' : (input.actorType ?? actor.type);
  await tx.execute(
    sql`insert into activities (id, workspace_id, contact_id, opportunity_id, lead_id, type, actor_type, actor_user_id, payload)
        values (${id}::uuid, ${actor.workspaceId}::uuid, ${input.contactId ?? null}::uuid, ${input.opportunityId ?? null}::uuid,
                ${input.leadId ?? null}::uuid, ${input.type}, ${actorType}, ${isUser ? actor.userId : null}::uuid,
                ${JSON.stringify(input.payload ?? {})}::jsonb)`,
  );
  if (input.contactId)
    await tx.execute(sql`update contacts set last_activity_at = now() where id = ${input.contactId}::uuid`);
  if (input.opportunityId)
    await tx.execute(
      sql`update opportunities set last_activity_at = now() where id = ${input.opportunityId}::uuid`,
    );
  if (isUser && HUMAN_TYPES.has(input.type)) {
    let contactId = input.contactId ?? null;
    if (!contactId && input.opportunityId) {
      contactId =
        (
          await one<{ contact_id: string }>(
            tx,
            sql`select contact_id from opportunities where id = ${input.opportunityId}::uuid`,
          )
        )?.contact_id ?? null;
    }
    if (contactId) await onHumanAction(tx, { leadId: input.leadId, contactId, actor });
  }
  return id;
}

interface ActivityRow {
  id: string;
  type: ActivityType;
  actor_type: 'user' | 'system' | 'ai';
  actor_user_id: string | null;
  opportunity_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export async function toActivityDtos(tx: Tx, actor: Actor, rs: ActivityRow[]): Promise<ActivityDto[]> {
  const names = await userNames(
    tx,
    rs.map((r) => r.actor_user_id),
  );
  return rs.map((r) =>
    activityDto.parse({
      id: r.id,
      type: r.type,
      actorType: r.actor_type,
      actorUserId: r.actor_user_id,
      actorName: r.actor_user_id ? (names.get(r.actor_user_id) ?? null) : null,
      ai: r.actor_type === 'ai' || r.type === 'ai_message',
      opportunityId: r.opportunity_id,
      payload: maskValueFields(actor, r.payload),
      occurredAt: isoReq(r.occurred_at),
    }),
  );
}

/** Timeline page for a contact (incl. its opportunities' entries) or one opportunity; newest first. */
export async function timelineIn(
  tx: Tx,
  actor: Actor,
  target: { contactId: string } | { opportunityId: string },
  query: { cursor?: string; limit?: number },
) {
  const limit = query.limit ?? 30;
  const where =
    'contactId' in target
      ? sql`a.contact_id = ${target.contactId}::uuid`
      : sql`a.opportunity_id = ${target.opportunityId}::uuid`;
  const rs = await rows<ActivityRow>(
    tx,
    sql`select a.id, a.type, a.actor_type, a.actor_user_id, a.opportunity_id, a.payload, a.occurred_at
        from activities a where a.workspace_id = ${actor.workspaceId}::uuid and ${where} and ${cursorSql('a', query.cursor)}
        order by a.id desc limit ${limit + 1}`,
  );
  const p = pageOf(rs, limit);
  return { items: await toActivityDtos(tx, actor, p.items), nextCursor: p.nextCursor };
}

async function visibleContactId(tx: Tx, actor: Actor, id: string): Promise<string> {
  const r = await one<{ id: string }>(
    tx,
    sql`select c.id from contacts c where c.workspace_id = ${actor.workspaceId}::uuid and c.id = ${id}::uuid
        and c.deleted_at is null and ${scopeSql(actor, 'contact')}`,
  );
  if (!r) throw notFound();
  return r.id;
}

export interface CreateActivityInput {
  contactId?: string;
  opportunityId?: string;
  type: 'note' | 'call';
  body: string;
  direction?: 'inbound' | 'outbound';
  outcome?: string;
  durationSeconds?: number;
}

export const crmActivityService = {
  /** GET /contacts/:id/timeline (crm.contact.view; out of scope → 404). */
  async contactTimeline(
    actor: Actor,
    id: string,
    query: { cursor?: string; limit?: number },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.contact.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => timelineIn(tx, actor, { contactId: await visibleContactId(tx, actor, id) }, query),
      opts,
    );
  },

  /** GET /opportunities/:id/timeline (crm.opportunity.view). */
  async opportunityTimeline(
    actor: Actor,
    id: string,
    query: { cursor?: string; limit?: number },
    opts: TxOptions = {},
  ) {
    assertPermission(actor, 'crm.opportunity.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const o = await one<{ id: string }>(
          tx,
          sql`select o.id from opportunities o where o.workspace_id = ${actor.workspaceId}::uuid and o.id = ${id}::uuid
              and o.deleted_at is null and ${scopeSql(actor, 'opportunity')}`,
        );
        if (!o) throw notFound();
        return timelineIn(tx, actor, { opportunityId: o.id }, query);
      },
      opts,
    );
  },

  /** POST /activities: a note or a logged call on a contact or opportunity (crm.contact.edit, F2.13). */
  async create(actor: Actor, input: CreateActivityInput, opts: TxOptions = {}): Promise<ActivityDto> {
    assertPermission(actor, 'crm.contact.edit');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        let contactId = input.contactId ?? null;
        let opportunityId: string | null = null;
        if (input.opportunityId) {
          const o = await one<{ id: string; contact_id: string }>(
            tx,
            sql`select o.id, o.contact_id from opportunities o where o.workspace_id = ${actor.workspaceId}::uuid
                and o.id = ${input.opportunityId}::uuid and o.deleted_at is null and ${scopeSql(actor, 'opportunity')}`,
          );
          if (!o) throw notFound();
          opportunityId = o.id;
          contactId = o.contact_id;
        } else if (contactId) {
          await visibleContactId(tx, actor, contactId);
        }
        const payload =
          input.type === 'note'
            ? { body: input.body }
            : {
                summary: input.body,
                direction: input.direction,
                outcome: input.outcome,
                durationSeconds: input.durationSeconds ?? 0,
              };
        const id = await recordActivity(tx, actor, { contactId, opportunityId, type: input.type, payload });
        await emit(tx, {
          workspaceId: actor.workspaceId,
          topic: 'contacts',
          ids: contactId ? [contactId] : [],
        });
        const row = await one<ActivityRow>(
          tx,
          sql`select id, type, actor_type, actor_user_id, opportunity_id, payload, occurred_at from activities where id = ${id}::uuid`,
        );
        return (await toActivityDtos(tx, actor, [row!]))[0]!;
      },
      opts,
    );
  },
};
