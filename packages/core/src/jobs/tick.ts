// POST /api/internal/tick use case (06 §7, 11 "Webhooks & internal"). Owner: Lane A (T-008).
// Auth: `Authorization: Bearer $CRON_SECRET` (constant-time; trigger 'manual') OR a valid
// `Upstash-Signature` over the RAW body + canonical tick URL (trigger from the signed body:
// 'cron' for the backstop schedule, else 'qstash'). Anything else → 401. No session, no CSRF.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { TickTrigger } from '@relay/db/schema';
import { config } from '../config';
import { AppError } from '../errors';
import { getTickVerifier, tickUrl } from '../integrations/qstash';
import type { TickVerifier } from '../integrations/qstash/types';
import { runDueWork, type RunDueWorkOptions, type TickResult } from './run-due-work';

/** Tick bodies are tiny; refuse anything bigger before hashing/parsing it. */
export const MAX_TICK_BODY_BYTES = 4096;

export interface TickRequest {
  authorization: string | null;
  signature: string | null;
  rawBody: string;
}

export interface TickAuthDeps {
  cronSecret: string | undefined;
  verifier: TickVerifier | null;
  /** Canonical tick URL (JWT `sub`); required for signature checks. */
  tickUrl: string | null;
}

/** Constant-time string compare (hash first so lengths never leak through timing). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

function triggerFromBody(raw: string): 'qstash' | 'cron' {
  try {
    const body = JSON.parse(raw) as { trigger?: unknown };
    return body?.trigger === 'cron' ? 'cron' : 'qstash';
  } catch {
    return 'qstash';
  }
}

/** Which trigger this request is allowed to run as, or null (→ 401). */
export async function authorizeTick(req: TickRequest, deps: TickAuthDeps): Promise<TickTrigger | null> {
  if (Buffer.byteLength(req.rawBody, 'utf8') > MAX_TICK_BODY_BYTES) return null;

  const auth = req.authorization?.trim();
  if (auth && /^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, '');
    return deps.cronSecret && token && safeEqual(token, deps.cronSecret) ? 'manual' : null;
  }

  if (req.signature && deps.verifier && deps.tickUrl) {
    const ok = await deps.verifier.verify({ signature: req.signature, body: req.rawBody, url: deps.tickUrl });
    return ok ? triggerFromBody(req.rawBody) : null;
  }
  return null;
}

/** Env-backed auth deps. PUBLIC_BASE_URL is read only when signature checking is configured. */
export function defaultTickAuthDeps(): TickAuthDeps {
  const verifier = getTickVerifier();
  return {
    cronSecret: config.jobs.CRON_SECRET,
    verifier,
    tickUrl: verifier ? tickUrl(config.core.PUBLIC_BASE_URL) : null,
  };
}

export interface HandleTickDeps {
  auth?: TickAuthDeps;
  run?: (opts: RunDueWorkOptions) => Promise<TickResult>;
}

/** Authorize, then run due work. Throws 401 UNAUTHENTICATED when not authorized. */
export async function handleTick(req: TickRequest, deps: HandleTickDeps = {}): Promise<TickResult> {
  const trigger = await authorizeTick(req, deps.auth ?? defaultTickAuthDeps());
  if (!trigger) throw new AppError('UNAUTHENTICATED', { message: 'tick: missing or invalid credentials' });
  return (deps.run ?? runDueWork)({ trigger });
}
