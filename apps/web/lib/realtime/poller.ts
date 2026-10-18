// Framework-free change-feed poller (docs/07 §2 "Realtime hook", ADR-0003). T-009 [Q11]
//
//  - polls every `intervalMs` (2 s), `liveIntervalMs` (1 s) while a live screen is mounted
//  - paused while the tab is hidden; polls immediately when it becomes visible again
//  - cursor = the SERVER's `now` (no client clock), re-sent minus `overlapMs` (5 s) so a hint whose
//    transaction committed just after the previous poll can't be missed; duplicates are dropped by id
//  - bursts are coalesced per topic for `debounceMs` (250 ms) before invalidating
//  - `reset` from the server (cursor too old / flood) invalidates everything
//  - after `maxFailures` consecutive failures status becomes 'paused' and polling backs off (cap 30 s)
import type { ChangesResponse, RealtimeChange, RealtimeTopic } from '@relay/contracts/api/realtime';
import { SeenIds } from './seen-ids';

export type RealtimeStatus = 'live' | 'paused';

export interface TopicHint {
  topic: RealtimeTopic;
  ids: string[];
}

export interface PollerOptions {
  fetchChanges: (since: string | undefined) => Promise<ChangesResponse>;
  /** Debounced: one entry per topic with the union of ids. `'all'` after a server reset. */
  onInvalidate: (hints: TopicHint[] | 'all') => void;
  /** Every NEW change immediately (toasts, sound cues). Not debounced. */
  onChange?: (change: RealtimeChange) => void;
  onStatus?: (status: RealtimeStatus) => void;
  isHidden?: () => boolean;
  isLive?: () => boolean;
  intervalMs?: number;
  liveIntervalMs?: number;
  overlapMs?: number;
  debounceMs?: number;
  maxFailures?: number;
  maxBackoffMs?: number;
}

export class RealtimePoller {
  private readonly o: Required<Omit<PollerOptions, 'onChange' | 'onStatus'>> &
    Pick<PollerOptions, 'onChange' | 'onStatus'>;
  private readonly seen = new SeenIds(500);
  private cursorMs: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<RealtimeTopic, Set<string>>();
  private pendingAll = false;
  private failures = 0;
  private running = false;
  private inFlight = false;
  private status: RealtimeStatus = 'live';

  constructor(opts: PollerOptions) {
    this.o = {
      ...opts,
      isHidden: opts.isHidden ?? (() => false),
      isLive: opts.isLive ?? (() => false),
      intervalMs: opts.intervalMs ?? 2000,
      liveIntervalMs: opts.liveIntervalMs ?? 1000,
      overlapMs: opts.overlapMs ?? 5000,
      debounceMs: opts.debounceMs ?? 250,
      maxFailures: opts.maxFailures ?? 3,
      maxBackoffMs: opts.maxBackoffMs ?? 30_000,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.flushTimer);
    this.timer = undefined;
    this.flushTimer = undefined;
  }

  /** Call when document visibility changes: resume immediately on show; hide just stops rescheduling. */
  visibilityChanged(): void {
    if (!this.running) return;
    if (!this.o.isHidden()) {
      clearTimeout(this.timer);
      this.schedule(0);
    }
  }

  private nextDelay(): number {
    if (this.failures > 0) {
      const base = this.o.isLive() ? this.o.liveIntervalMs : this.o.intervalMs;
      return Math.min(this.o.maxBackoffMs, base * 2 ** this.failures);
    }
    return this.o.isLive() ? this.o.liveIntervalMs : this.o.intervalMs;
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  /** One poll. Public for tests; normally driven by the timer. */
  async poll(): Promise<void> {
    if (!this.running || this.inFlight) return;
    if (this.o.isHidden()) return; // paused; visibilityChanged() restarts it
    this.inFlight = true;
    try {
      const hadCursor = this.cursorMs !== undefined;
      const since = hadCursor
        ? new Date((this.cursorMs as number) - this.o.overlapMs).toISOString()
        : undefined;
      const res = await this.o.fetchChanges(since);
      if (!this.running) return;
      this.cursorMs = Date.parse(res.now);
      if (res.reset && hadCursor) {
        this.pendingAll = true;
        this.pending.clear();
        this.armFlush();
      }
      for (const change of res.changes) {
        if (!this.seen.add(change.id)) continue;
        this.o.onChange?.(change);
        if (this.pendingAll) continue;
        const set = this.pending.get(change.topic) ?? new Set<string>();
        for (const id of change.ids) set.add(id);
        this.pending.set(change.topic, set);
        this.armFlush();
      }
      this.failures = 0;
      this.setStatus('live');
    } catch {
      this.failures += 1;
      if (this.failures >= this.o.maxFailures) this.setStatus('paused');
    } finally {
      this.inFlight = false;
      if (this.running && !this.o.isHidden()) this.schedule(this.nextDelay());
    }
  }

  private armFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), this.o.debounceMs);
  }

  private flush(): void {
    this.flushTimer = undefined;
    if (this.pendingAll) {
      this.pendingAll = false;
      this.pending.clear();
      this.o.onInvalidate('all');
      return;
    }
    const hints = [...this.pending].map(([topic, ids]) => ({ topic, ids: [...ids] }));
    this.pending.clear();
    if (hints.length > 0) this.o.onInvalidate(hints);
  }

  private setStatus(s: RealtimeStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.o.onStatus?.(s);
  }
}
