// PATCH/DELETE /api/v1/ai/knowledge/:id
import { kbPatch } from '@relay/contracts/api/ai';
import { aiAdminService } from '@relay/core/services/ai-admin';
import { z } from 'zod';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid() });

export const PATCH = route({
  auth: 'session',
  permission: 'ai.manage',
  params,
  body: kbPatch,
  handler: ({ actor, params: p, body }) => aiAdminService.kbUpdate(actor, p.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'ai.manage',
  params,
  handler: ({ actor, params: p }) => aiAdminService.kbDelete(actor, p.id),
});
