// POST /api/v1/exports (F2.11): CSV of contacts / companies / opportunities / a saved list. crm.export,
// same record visibility as the UI, opportunity value masked without the value permission, audited.
import { exportInput } from '@relay/contracts/api/crm';
import { exportsService } from '@relay/core/services/exports';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.export',
  body: exportInput,
  rateLimit: { name: 'crm.export', limit: 10, windowSeconds: 60, by: 'user' },
  handler: async ({ actor, body }) => {
    const r = await exportsService.create(actor, body);
    return new Response(r.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${r.filename}"`,
        'x-row-count': String(r.rowCount),
      },
    });
  },
});
