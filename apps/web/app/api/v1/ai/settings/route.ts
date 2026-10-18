// GET/PUT /api/v1/ai/settings (F6.1): stand-in mode, daily cap, triage toggle. Needs `ai.manage`.
import { aiSettingsInput } from '@relay/contracts/api/ai';
import { aiAdminService } from '@relay/core/services/ai-admin';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'ai.manage',
  handler: ({ actor }) => aiAdminService.getSettings(actor),
});

export const PUT = route({
  auth: 'session',
  permission: 'ai.manage',
  body: aiSettingsInput,
  handler: ({ actor, body }) => aiAdminService.putSettings(actor, body),
});
