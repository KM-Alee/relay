// DB-backed fixed-window rate limiter (docs/06-security.md §1; Postgres-only, no extra service).
// Keys (06 §1): `login:ip:<ip>` 20/15 min, `login:email:<sha256>` 5/15 min, `form:ip:<ip>` 10/10 min,
// `nudge:user:<id>` 6/min, invite accept, Slack link start.
import { withSystemTx, type TxOptions } from '@relay/db';
import { AppError } from '../errors';
import * as repo from '../repos/rate-limits';

export interface RateLimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

export type RateLimiter = (rule: RateLimitRule) => Promise<RateLimitResult>;

function check(rule: RateLimitRule): void {
  if (!rule.key || rule.key.length > 512) throw new Error('rate limit key must be 1..512 chars');
  if (!Number.isInteger(rule.limit) || rule.limit < 1)
    throw new Error('rate limit must be a positive integer');
  if (!Number.isInteger(rule.windowSeconds) || rule.windowSeconds < 1)
    throw new Error('window must be ≥ 1 s');
}

/** Count a hit and report whether it is within the limit. Runs in its own short system tx. */
export async function consume(rule: RateLimitRule, opts: TxOptions = {}): Promise<RateLimitResult> {
  check(rule);
  const h = await withSystemTx((tx) => repo.hit(tx, rule.key, rule.windowSeconds), opts);
  return {
    allowed: h.count <= rule.limit,
    count: h.count,
    limit: rule.limit,
    retryAfterSeconds: h.retryAfterSeconds,
  };
}

/** Like consume() but throws `429 RATE_LIMITED` (details.retryAfter, seconds) when over the limit. */
export async function enforce(rule: RateLimitRule, limiter: RateLimiter = consume): Promise<RateLimitResult> {
  const r = await limiter(rule);
  if (!r.allowed) throw new AppError('RATE_LIMITED', { details: { retryAfter: r.retryAfterSeconds } });
  return r;
}

export async function pruneOld(opts: TxOptions = {}): Promise<number> {
  return withSystemTx((tx) => repo.prune(tx), opts);
}

export const rateLimitService = { consume, enforce, pruneOld };
