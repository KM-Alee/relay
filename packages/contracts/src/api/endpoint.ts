// Endpoint descriptor shared by the server route and the typed client (13 §4).
// `path` uses `:name` params, e.g. '/api/v1/leads/:id/acknowledge'.
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Endpoint<
  Res extends z.ZodType = z.ZodType,
  Body extends z.ZodType | undefined = z.ZodType | undefined,
  Query extends z.ZodType | undefined = z.ZodType | undefined,
  Params extends z.ZodType | undefined = z.ZodType | undefined,
> {
  method: HttpMethod;
  path: `/api/${string}`;
  response: Res;
  body?: Body;
  query?: Query;
  params?: Params;
}

/** Identity helper that keeps the literal types: `export const me = endpoint({ ... })`. */
export function endpoint<
  Res extends z.ZodType,
  Body extends z.ZodType | undefined = undefined,
  Query extends z.ZodType | undefined = undefined,
  Params extends z.ZodType | undefined = undefined,
>(e: Endpoint<Res, Body, Query, Params>): Endpoint<Res, Body, Query, Params> {
  return e;
}
