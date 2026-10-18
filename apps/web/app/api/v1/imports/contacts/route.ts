// POST /api/v1/imports/contacts (F2.12): validate (dry run) or commit one chunk of mapped CSV rows.
// crm.import (+ crm.contact.create); rows are re-validated server-side; invalid rows are reported, valid ones import.
import { importChunkInput } from '@relay/contracts/api/crm-extras';
import { importService } from '@relay/core/services/crm-import';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.import',
  body: importChunkInput,
  rateLimit: { name: 'crm.import', limit: 120, windowSeconds: 60, by: 'user' },
  handler: ({ actor, body }) => importService.chunk(actor, body),
});
