// route(): the ONE wrapper every /api route handler uses (docs/11-api.md §1, 01 §5).
//
//   export const POST = route({
//     auth: 'session',
//     permission: 'leads.create',
//     body: createLeadInput,                     // Zod schema from @relay/contracts
//     rateLimit: { name: 'leads.create', limit: 30, windowSeconds: 60, by: 'user' },
//     handler: ({ actor, body }) => leadsService.create(actor, body),   // ONE service call
//   });
//
// Pipeline: CSRF (unsafe methods, non-exempt paths) → session → Actor → permission → rate limit →
// Zod-parse params/query/body → handler → JSON (or a raw Response) → errors as the typed envelope.
// Every response gets `Cache-Control: no-store` and a csrf cookie if the caller lacks a valid one.
import { hasPermission, type Actor } from '@relay/core/auth/actor';
import { CSRF_COOKIE, CSRF_HEADER, verifyCsrf } from '@relay/core/auth/csrf';
import { config } from '@relay/core/config';
import { AppError, toErrorResponse, validationError } from '@relay/core/errors';
import { consume, type RateLimiter } from '@relay/core/services/rate-limit';
import type { z } from 'zod';
import { ensureCsrfCookie } from './csrf-cookie';
import { clientIp, readCookie, requestHost } from './request';
import { resolveActor as defaultResolveActor, type ResolveActor } from './session';

type AuthMode = 'session' | 'public';
type Schema = z.ZodType;
type Out<S> = S extends Schema ? z.output<S> : undefined;

export interface RouteContext<A extends AuthMode, B, Q, P> {
  req: Request;
  actor: A extends 'session' ? Actor : Actor | null;
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
  ip: string;
}

export interface RateLimitSpec {
  /** Key prefix, e.g. 'login' → `login:ip:<ip>`. */
  name: string;
  limit: number;
  windowSeconds: number;
  by: 'ip' | 'user';
}

export interface RouteSpec<
  A extends AuthMode,
  B extends Schema | undefined,
  Q extends Schema | undefined,
  P extends Schema | undefined,
  R,
> {
  auth: A;
  /** Permission key checked before the handler (services re-check + apply record scope). */
  permission?: A extends 'session' ? string : never;
  body?: B;
  query?: Q;
  params?: P;
  rateLimit?: RateLimitSpec;
  /** Success status (default 200). */
  status?: number;
  handler: (ctx: RouteContext<A, B, Q, P>) => Promise<R | Response> | R | Response;
}

export interface RouteDeps {
  resolveActor: ResolveActor;
  rateLimiter: RateLimiter;
  /** SESSION_SECRET: signs csrf tokens. */
  csrfSecret: () => string;
  /** Origins trusted besides the request's own host (PUBLIC_BASE_URL). */
  trustedOrigins: () => string[];
  secureCookies: () => boolean;
  logError: (err: unknown, meta: { method: string; path: string }) => void;
}

/** Next.js App Router handler signature (params is a Promise since Next 15). */
export type NextHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

const defaultDeps: RouteDeps = {
  resolveActor: defaultResolveActor,
  rateLimiter: consume,
  csrfSecret: () => config.core.SESSION_SECRET,
  trustedOrigins: () => [new URL(config.core.PUBLIC_BASE_URL).origin],
  secureCookies: () => config.core.NODE_ENV === 'production',
  // TODO(core/log.ts): route through the redacting logger once it exists (06 §5).
  logError: (err, meta) => {
    const e = err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) };
    console.error('[api] unhandled error', { ...meta, ...e });
  },
};

function parseWith<S extends Schema | undefined>(
  schema: S,
  input: unknown,
  where: 'body' | 'query' | 'params',
): Out<S> {
  if (!schema) return undefined as Out<S>;
  const res = schema.safeParse(input);
  if (!res.success) throw validationError(res.error, where);
  return res.data as Out<S>;
}

async function readJsonBody(req: Request): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^application\/(.+\+)?json\b/i.test(type)) throw new AppError('UNSUPPORTED_MEDIA_TYPE');
  try {
    return await req.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', {
      details: { in: 'body', issues: [{ path: '', code: 'invalid_json' }] },
    });
  }
}

export function createRoute(deps: RouteDeps) {
  return function route<
    A extends AuthMode,
    B extends Schema | undefined = undefined,
    Q extends Schema | undefined = undefined,
    P extends Schema | undefined = undefined,
    R = unknown,
  >(spec: RouteSpec<A, B, Q, P, R>): NextHandler {
    return async (req, nextCtx) => {
      const url = new URL(req.url);
      const csrfCookie = readCookie(req, CSRF_COOKIE);
      let res: Response;
      try {
        // 1. CSRF (06 §4): Origin/Host + signed double-submit on unsafe methods.
        const csrf = verifyCsrf({
          method: req.method,
          pathname: url.pathname,
          origin: req.headers.get('origin'),
          referer: req.headers.get('referer'),
          host: requestHost(req),
          cookieToken: csrfCookie,
          headerToken: req.headers.get(CSRF_HEADER),
          trustedOrigins: deps.trustedOrigins(),
          secret: deps.csrfSecret(),
        });
        if (!csrf.ok) {
          // The reason stays server-side (internal message); the client only sees CSRF_FAILED.
          throw new AppError('CSRF_FAILED', { message: `csrf: ${csrf.reason}` });
        }

        // 2. Session → Actor.
        const actor = await deps.resolveActor(req);
        if (spec.auth === 'session' && !actor) throw new AppError('UNAUTHENTICATED');

        // 3. Declared permission (services still check + scope records; F1.5).
        if (spec.permission && actor && !hasPermission(actor, spec.permission))
          throw new AppError('FORBIDDEN');

        // 4. Rate limit.
        const ip = clientIp(req);
        if (spec.rateLimit) {
          const rl = spec.rateLimit;
          const who = rl.by === 'user' && actor ? `user:${actor.userId}` : `ip:${ip}`;
          const r = await deps.rateLimiter({
            key: `${rl.name}:${who}`,
            limit: rl.limit,
            windowSeconds: rl.windowSeconds,
          });
          if (!r.allowed)
            throw new AppError('RATE_LIMITED', { details: { retryAfter: r.retryAfterSeconds } });
        }

        // 5. Zod-parse input (never trust a client workspaceId: it is not part of any schema).
        const params = parseWith(spec.params as P, await nextCtx.params, 'params');
        const query = parseWith(spec.query as Q, Object.fromEntries(url.searchParams), 'query');
        const body = spec.body
          ? parseWith(spec.body as B, await readJsonBody(req), 'body')
          : (undefined as Out<B>);

        // 6. One service call.
        const result = await spec.handler({
          req,
          actor: actor as RouteContext<A, B, Q, P>['actor'],
          body,
          query,
          params,
          ip,
        });
        res =
          result instanceof Response
            ? result
            : spec.status === 204
              ? new Response(null, { status: 204 })
              : Response.json(result ?? null, { status: spec.status ?? 200 });
      } catch (err) {
        const { status, body, appError } = toErrorResponse(err);
        if (status >= 500) deps.logError(appError.cause ?? err, { method: req.method, path: url.pathname });
        res = Response.json(body, { status });
        if (appError.code === 'RATE_LIMITED' && typeof appError.details?.retryAfter === 'number') {
          res.headers.set('retry-after', String(appError.details.retryAfter));
        }
      }
      try {
        if (!res.headers.has('cache-control')) res.headers.set('cache-control', 'no-store');
        ensureCsrfCookie(res, csrfCookie, deps.csrfSecret(), deps.secureCookies());
      } catch {
        // Immutable headers (e.g. Response.redirect) or missing SESSION_SECRET (reported at boot):
        // never mask the real response.
      }
      return res;
    };
  };
}

/** The production wrapper. Tests use createRoute() with fakes. */
export const route = createRoute(defaultDeps);
