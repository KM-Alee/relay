// GET /api/v1/message-templates: approved WhatsApp templates for outside-window sends (I1.10).
import { messagingService } from '@relay/core/services/messaging';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  handler: ({ actor }) => messagingService.listTemplates(actor),
});
