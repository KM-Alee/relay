// POST /api/internal/tick handler factory (the route file may only export Next route fields).
// Not wrapped in route(): there is no session or CSRF here. Auth is a QStash signature over the
// RAW body, or `Bearer CRON_SECRET` (core/jobs/tick.ts). Errors use the standard envelope.
import { toErrorResponse } from '@relay/core/errors';
import { handleTick, type HandleTickDeps } from '@relay/core/jobs/tick';
import { log } from '@relay/core/log';

export function createTickHandler(deps: HandleTickDeps = {}): (req: Request) => Promise<Response> {
  return async (req) => {
    let res: Response;
    try {
      // Read the body as TEXT before anything else: the signature covers these exact bytes.
      const rawBody = await req.text();
      const result = await handleTick(
        {
          authorization: req.headers.get('authorization'),
          signature: req.headers.get('upstash-signature'),
          rawBody,
        },
        deps,
      );
      res = Response.json(result);
    } catch (err) {
      const { status, body, appError } = toErrorResponse(err);
      if (status >= 500) log.error('tick.failed', { err: appError.cause ?? err });
      res = Response.json(body, { status });
    }
    res.headers.set('cache-control', 'no-store');
    return res;
  };
}
