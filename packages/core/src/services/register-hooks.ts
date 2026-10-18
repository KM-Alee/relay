// ONE place that connects the lead engine to the other lanes' seams. Import it for its side effect
// from every server entry point (apps/web/lib/http/route.ts, the webhook libs, instrumentation, and
// core/jobs/run-due-work.ts for ticks/ticker/QStash). Idempotent: registering twice is a no-op.
// Owner: Lane A.
import { guardUserDeactivation, onUserDeactivated, onUserJoined } from '../auth/user-lifecycle';
import { registerHumanActionHandler } from './crm-activity';
import { addToDefaultTeam, guardFallbackOwner, transferLeadsOnDeactivation } from './lead-actions';
import { onCrmHumanAction, onInboundWhatsApp, onOutboundHumanMessage, onTranscript } from './lead-hooks';
import {
  onTranscriptReady,
  registerInboundCustomerMessageHandler,
  registerOutboundHumanMessageHandler,
} from './messaging-hooks';

// Module-level (not globalThis): each bundled copy of the registries needs its own registration.
let registered = false;

export function registerLeadHooks(): void {
  if (registered) return;
  registered = true;
  registerInboundCustomerMessageHandler(onInboundWhatsApp); // T1 from WhatsApp (I1.5)
  registerOutboundHumanMessageHandler(onOutboundHumanMessage); // T10 message_out + AI handoff
  registerHumanActionHandler(onCrmHumanAction); // T10 note/call/stage change; T11 won/lost
  onTranscriptReady(onTranscript); // F8.2 voice note → urgency + stand-in
  guardUserDeactivation(guardFallbackOwner); // F1.8 fallback owner rule
  onUserDeactivated(transferLeadsOnDeactivation); // T6
  onUserJoined(addToDefaultTeam); // join → default team rotation
}

registerLeadHooks();
