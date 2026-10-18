// Contact 360 (T-117, F2.8): everything about one contact in a single read. Owner: Lane B.
// Conversations / payments / appointments belong to Lane C: they plug in through `registerContact360Provider`
// (one call each from their service module); until then those sections are empty lists.
import type { CompanyDto, ContactDto, relatedItem } from '@relay/contracts/api/crm';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { notFound } from '../errors';
import { timelineIn } from './crm-activity';
import { companyDtos, contactDtos, opportunityDtos, queryRows } from './crm-records';

export type RelatedItem = z.infer<typeof relatedItem>;
export type RelatedKind = 'conversations' | 'payments' | 'appointments';
/** Return the contact's records of one kind, already permission-scoped for `actor`. */
export type Contact360Provider = (tx: Tx, actor: Actor, contactId: string) => Promise<RelatedItem[]>;

const providers: Partial<Record<RelatedKind, Contact360Provider>> = {};
export function registerContact360Provider(kind: RelatedKind, provider: Contact360Provider): void {
  providers[kind] = provider;
}

export const contact360Service = {
  /** GET /contacts/:id/360 (crm.contact.view; out of scope → 404). */
  async get(actor: Actor, id: string, opts: TxOptions = {}) {
    assertPermission(actor, 'crm.contact.view');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await queryRows(tx, actor, 'contact', { ids: [id], limit: 1 });
        if (!r.rows[0]) throw notFound();
        const contact: ContactDto = (await contactDtos(tx, r.rows as never))[0]!;
        let company: CompanyDto | null = null;
        if (contact.companyId && can(actor, 'crm.company.view')) {
          const c = await queryRows(tx, actor, 'company', {
            ids: [contact.companyId],
            limit: 1,
            noScope: true,
          });
          company = c.rows[0] ? (await companyDtos(tx, c.rows as never))[0]! : null;
        }
        const opps = can(actor, 'crm.opportunity.view')
          ? await queryRows(tx, actor, 'opportunity', { limit: 100, extra: sql`o.contact_id = ${id}::uuid` })
          : { rows: [] };
        return {
          contact,
          company,
          opportunities: await opportunityDtos(tx, actor, opps.rows as never),
          related: {
            conversations: (await providers.conversations?.(tx, actor, id)) ?? [],
            payments: (await providers.payments?.(tx, actor, id)) ?? [],
            appointments: (await providers.appointments?.(tx, actor, id)) ?? [],
          },
          timeline: await timelineIn(tx, actor, { contactId: id }, { limit: 30 }),
        };
      },
      opts,
    );
  },
};
