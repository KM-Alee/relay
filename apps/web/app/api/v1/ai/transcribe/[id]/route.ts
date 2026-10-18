// POST /api/v1/ai/transcribe/:id: Retry a failed voice-note transcription (F8.3). Visibility-scoped (404).
import { retryTranscription } from '@relay/core/services/voice';
import { z } from 'zod';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.contact.view',
  params: z.object({ id: z.uuid() }),
  rateLimit: { name: 'ai.transcribe_retry', limit: 20, windowSeconds: 60, by: 'user' },
  handler: ({ actor, params }) => retryTranscription(actor, params.id),
});
