// Typed fetch for contract endpoints (13 §4, 11 §1): path params, query, JSON body, x-csrf-token on
// mutations, response parsed with the contract's Zod schema, errors as ApiError (readApiError).
import type { Endpoint } from '@relay/contracts/api/endpoint';
import type { z } from 'zod';
import { ApiError, readApiError, toApiError } from '@/lib/http/client-error';
import { fixturesEnabled, type ApiDomain } from './fixtures';

const CSRF_COOKIE = 'csrf';
const CSRF_HEADER = 'x-csrf-token';
const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

type In<S> = S extends z.ZodType ? z.input<S> : undefined;

type ParamsOf<E> =
  E extends Endpoint<z.ZodType, z.ZodType | undefined, z.ZodType | undefined, infer P> ? P : never;
type QueryOf<E> = E extends Endpoint<z.ZodType, z.ZodType | undefined, infer Q> ? Q : never;
type BodyOf<E> = E extends Endpoint<z.ZodType, infer B> ? B : never;

export type CallInput<E extends Endpoint> = ([ParamsOf<E>] extends [z.ZodType]
  ? { params: In<ParamsOf<E>> }
  : { params?: undefined }) &
  ([QueryOf<E>] extends [z.ZodType] ? { query?: In<QueryOf<E>> } : { query?: undefined }) &
  ([BodyOf<E>] extends [z.ZodType] ? { body: In<BodyOf<E>> } : { body?: undefined });

export type CallOutput<E extends Endpoint> = z.output<E['response']>;

function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

async function csrfToken(fetchImpl: typeof fetch): Promise<string | undefined> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  // First mutation of the session: GET /api/v1/csrf sets the readable cookie.
  await fetchImpl('/api/v1/csrf', { credentials: 'same-origin' });
  return readCsrfCookie();
}

export function buildPath(
  path: string,
  params?: Record<string, unknown>,
  query?: Record<string, unknown>,
): string {
  const filled = path.replace(/:([A-Za-z_]+)/g, (_, k: string) => {
    const v = params?.[k];
    if (v === undefined || v === null) throw new Error(`missing path param :${k}`);
    return encodeURIComponent(String(v));
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${filled}?${s}` : filled;
}

export interface CallOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Call `endpoint` for `domain`. In fixture mode returns `fixture(input)` (validated by the same
 * response schema, so fixtures can't drift from the contract).
 */
export async function call<E extends Endpoint>(
  domain: ApiDomain,
  endpoint: E,
  input: CallInput<E>,
  fixture: (input: CallInput<E>) => CallOutput<E> | Promise<CallOutput<E>>,
  opts: CallOptions = {},
): Promise<CallOutput<E>> {
  if (fixturesEnabled(domain)) return endpoint.response.parse(await fixture(input)) as CallOutput<E>;

  const fetchImpl = opts.fetchImpl ?? fetch;
  const { params, query, body } = input as { params?: object; query?: object; body?: unknown };
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (UNSAFE.has(endpoint.method)) {
    const token = await csrfToken(fetchImpl);
    if (token) headers[CSRF_HEADER] = token;
  }
  let res: Response;
  try {
    res = await fetchImpl(
      buildPath(endpoint.path, params as Record<string, unknown>, query as Record<string, unknown>),
      {
        method: endpoint.method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts.signal,
      },
    );
  } catch (err) {
    throw toApiError(err);
  }
  if (!res.ok) throw await readApiError(res);
  if (res.status === 204) return endpoint.response.parse(undefined) as CallOutput<E>;
  const parsed = endpoint.response.safeParse(await res.json());
  if (!parsed.success) throw new ApiError('INTERNAL', res.status);
  return parsed.data as CallOutput<E>;
}

export { CSRF_COOKIE, CSRF_HEADER };
