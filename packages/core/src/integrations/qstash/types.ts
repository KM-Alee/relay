// QStash wake-up contracts (docs/04-integrations.md §1, 01 §6, ADR-0002). Owner: Lane A (T-008).
// QStash only WAKES us up. Correctness lives in Postgres: a lost wake delays work until the next
// nudge / after() kick / cron backstop, it never loses it.

/** The body every QStash-originated tick carries (signed: the JWT covers the body hash). */
export interface TickBody {
  trigger: 'qstash' | 'cron';
  /** ISO time the wake was scheduled for (wake-ups only). */
  at?: string;
}

export interface WakeScheduler {
  readonly kind: 'qstash' | 'fake' | 'disabled';
  /** false → ensureWakeBy is a no-op (local dev without QStash: the dev ticker drives work). */
  readonly enabled: boolean;
  /** Deliver `POST /api/internal/tick` at `at` (whole seconds). `dedupeId` = `wake:<epochSecond>`. */
  scheduleAt(at: Date, dedupeId: string): Promise<{ messageId: string }>;
  /** Cancel a scheduled wake (Judge Console "lose the doorbell"). Unknown/delivered ids are ignored. */
  cancel(messageId: string): Promise<void>;
}

export interface VerifyTickRequest {
  /** `Upstash-Signature` header (a JWT). */
  signature: string;
  /** RAW request body, byte for byte. */
  body: string;
  /** The URL QStash was asked to call (JWT `sub`). */
  url: string;
}

export interface TickVerifier {
  /** true only for a valid signature by the current or next signing key over this body + URL. */
  verify(req: VerifyTickRequest): Promise<boolean>;
}
