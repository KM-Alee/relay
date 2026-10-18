// Inbound-message hook registry (T-141 <-> Lane A intake, T-122/T-203). Lane C does not import Lane A code:
// Lane A calls `registerInboundCustomerMessageHandler(handler)` once at module load (e.g. from its
// leads service index). If nothing is registered, the message is just stored.
//
// The handler runs INSIDE the transaction that stored the message (workspace-scoped `tx`), so intake
// (contact create + lead + assignment) and the message commit atomically. It must not call providers.
import type { Tx } from '@relay/db';

export interface InboundCustomerMessage {
  workspaceId: string;
  /** Matched contact (by phone_e164) or null: the handler creates the contact + lead (source_kind 'whatsapp'). */
  contactId: string | null;
  /** E.164, e.g. "+923001234567" */
  phone: string;
  /** WhatsApp profile name, if sent */
  name: string | null;
  /** Text (or caption). null for pure media / unsupported types. */
  text: string | null;
  conversationId: string;
  messageId: string;
  at: Date;
}

/** Return the contact id when the handler created/resolved one: it is linked to the conversation. */
export type InboundCustomerMessageResult = void | { contactId?: string | null };

export type InboundCustomerMessageHandler = (
  tx: Tx,
  msg: InboundCustomerMessage,
) => Promise<InboundCustomerMessageResult>;

const handlers = new Set<InboundCustomerMessageHandler>();

/** Register a handler; returns an unregister function (tests). Re-registering the same function is a no-op. */
export function registerInboundCustomerMessageHandler(h: InboundCustomerMessageHandler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

/** Alias matching the agreed hook name `onInboundCustomerMessage`. */
export const onInboundCustomerMessage = registerInboundCustomerMessageHandler;

export async function runInboundHandlers(
  tx: Tx,
  msg: InboundCustomerMessage,
): Promise<{ contactId: string | null }> {
  let contactId = msg.contactId;
  for (const h of handlers) {
    const r = await h(tx, { ...msg, contactId });
    if (r && r.contactId) contactId = r.contactId;
  }
  return { contactId };
}
