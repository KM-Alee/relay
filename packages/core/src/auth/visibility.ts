// Record-visibility scope (docs/06-security.md §2 "Record visibility", F1.5, F1.6, Q2). T-102.
//
// Without `leads.view_all` a user sees leads they own; contacts they own OR that have an open lead owned
// by them; and the conversations/opportunities/payments/appointments of those contacts. Apply the SAME
// scope to lists, details, search, saved lists, drill-downs, exports and dashboard counts.
// Out-of-scope or other-workspace ids → 404 (`foundOr404`), never 403.
//
//   const where = and(eq(leads.workspaceId, ws), leadScopeSql(actor, leads.ownerUserId));
//   const where = and(eq(contacts.workspaceId, ws), contactScopeSql(actor, contacts.id, contacts.ownerUserId));
//   return foundOr404(row);
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { notFound } from '../errors';
import type { Actor } from './actor';
import { can } from './permissions';

export type LeadScope = { all: true } | { all: false; ownerUserId: string };

/** 06 §2 enforcement API. */
export function visibleLeadScope(actor: Actor): LeadScope {
  return can(actor, 'leads.view_all') ? { all: true } : { all: false, ownerUserId: actor.userId };
}

/** WHERE fragment for owner-scoped rows (leads; opportunities by owner when used alone). */
export function leadScopeSql(actor: Actor, ownerColumn: SQLWrapper): SQL {
  const s = visibleLeadScope(actor);
  return s.all ? sql`true` : sql`${ownerColumn} = ${s.ownerUserId}`;
}

/**
 * WHERE fragment for contacts: owned by the actor OR with an open lead owned by the actor.
 * Child records (conversations, opportunities, payments, appointments) use it on their contact id:
 * `contactScopeSql(actor, conversations.contactId)` (owner column omitted → only the subqueries).
 * Requires the `leads` and `contacts` tables (Lanes A/B, W2).
 */
export function contactScopeSql(actor: Actor, contactIdColumn: SQLWrapper, ownerColumn?: SQLWrapper): SQL {
  if (can(actor, 'leads.view_all')) return sql`true`;
  const me = actor.userId;
  const viaLead = sql`exists (select 1 from leads l where l.workspace_id = ${actor.workspaceId} and l.contact_id = ${contactIdColumn} and l.status = 'open' and l.owner_user_id = ${me})`;
  const owned = ownerColumn
    ? sql`${ownerColumn} = ${me}`
    : sql`exists (select 1 from contacts c where c.workspace_id = ${actor.workspaceId} and c.id = ${contactIdColumn} and c.owner_user_id = ${me})`;
  return sql`(${owned} or ${viaLead})`;
}

/** Detail lookups: a missing row (other workspace via RLS, or out of scope) is a 404. */
export function foundOr404<T>(row: T | null | undefined): T {
  if (row === null || row === undefined) throw notFound();
  return row;
}
