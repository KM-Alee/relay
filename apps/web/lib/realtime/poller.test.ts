import type { ChangesResponse, RealtimeChange } from '@relay/contracts/api/realtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireLive, isLive } from './live';
import { RealtimePoller, type TopicHint } from './poller';
import { SeenIds } from './seen-ids';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const change = (n: number, topic: RealtimeChange['topic'] = 'leads', ids = [u(900 + n)]): RealtimeChange => ({
  id: u(n),
  topic,
  ids,
  at: '2026-10-18T10:00:00.000Z',
});
const resp = (now: string, changes: RealtimeChange[] = [], reset = false): ChangesResponse => ({
  now,
  reset,
  changes,
});

describe('[Q11] SeenIds', () => {
  it('[Q11] dedupes by id and is bounded (oldest dropped)', () => {
    const s = new SeenIds(3);
    expect(['a', 'b', 'a'].map((x) => s.add(x))).toEqual([true, true, false]);
    s.add('c');
    s.add('d'); // evicts 'a'
    expect(s.size).toBe(3);
    expect(s.add('a')).toBe(true);
    expect(s.add('d')).toBe(false);
  });
});

describe('[Q11] live registry', () => {
  it('[Q11] ref-counts live screens and release is idempotent', () => {
    const r1 = acquireLive();
    const r2 = acquireLive();
    expect(isLive()).toBe(true);
    r1();
    r1();
    expect(isLive()).toBe(true);
    r2();
    expect(isLive()).toBe(false);
  });
});

describe('[Q11] RealtimePoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(
    responses: Array<ChangesResponse | Error>,
    extra: { hidden?: () => boolean; live?: () => boolean } = {},
  ) {
    const sinces: Array<string | undefined> = [];
    const invalidations: Array<TopicHint[] | 'all'> = [];
    const changes: RealtimeChange[] = [];
    const statuses: string[] = [];
    let i = 0;
    const poller = new RealtimePoller({
      fetchChanges: async (since) => {
        sinces.push(since);
        const r = responses[Math.min(i++, responses.length - 1)]!;
        if (r instanceof Error) throw r;
        return r;
      },
      onInvalidate: (h) => invalidations.push(h),
      onChange: (c) => changes.push(c),
      onStatus: (s) => statuses.push(s),
      isHidden: extra.hidden,
      isLive: extra.live,
    });
    return { poller, sinces, invalidations, changes, statuses };
  }

  it('[Q11] first poll fetches a cursor only; later polls send server now minus the 5 s overlap', async () => {
    const t = setup([resp('2026-10-18T10:00:10.000Z'), resp('2026-10-18T10:00:12.000Z')]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.sinces).toEqual([undefined, '2026-10-18T10:00:05.000Z']);
    t.poller.stop();
  });

  it('[Q11] overlapping polls return the same event; it is delivered and invalidated once', async () => {
    const c = change(1);
    const t = setup([
      resp('2026-10-18T10:00:00.000Z'),
      resp('2026-10-18T10:00:02.000Z', [c]),
      resp('2026-10-18T10:00:04.000Z', [c]), // overlap window returns it again
    ]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.changes).toHaveLength(1);
    expect(t.invalidations).toEqual([[{ topic: 'leads', ids: c.ids }]]);
    t.poller.stop();
  });

  it('[Q11] a burst is coalesced into one invalidation per topic (250 ms debounce)', async () => {
    const t = setup([
      resp('2026-10-18T10:00:00.000Z'),
      resp('2026-10-18T10:00:02.000Z', [change(1), change(2), change(3, 'contacts')]),
    ]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.invalidations).toHaveLength(0); // still inside the debounce
    await vi.advanceTimersByTimeAsync(250);
    expect(t.invalidations).toHaveLength(1);
    const hints = t.invalidations[0] as TopicHint[];
    expect(hints.map((h) => h.topic).sort()).toEqual(['contacts', 'leads']);
    expect(hints.find((h) => h.topic === 'leads')!.ids).toHaveLength(2);
    t.poller.stop();
  });

  it('[Q11] polls every 2 s, every 1 s while a live screen is mounted', async () => {
    let live = false;
    const t = setup([resp('2026-10-18T10:00:00.000Z')], { live: () => live });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.sinces).toHaveLength(3); // t=0, 2, 4
    live = true;
    await vi.advanceTimersByTimeAsync(2000); // next scheduled at 6 (old delay), then 1 s cadence
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.sinces.length).toBeGreaterThanOrEqual(6);
    t.poller.stop();
  });

  it('[Q11] does not poll while the tab is hidden and polls immediately when visible again', async () => {
    let hidden = true;
    const t = setup([resp('2026-10-18T10:00:00.000Z')], { hidden: () => hidden });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.sinces).toHaveLength(0);
    hidden = false;
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sinces).toHaveLength(1);
    t.poller.stop();
  });

  it('[Q11] server reset invalidates everything; the first (cursor-less) reset is ignored', async () => {
    const t = setup([
      resp('2026-10-18T10:00:00.000Z', [], true),
      resp('2026-10-18T10:00:02.000Z', [change(1)], true),
    ]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(2300);
    expect(t.invalidations).toEqual(['all']);
    t.poller.stop();
  });

  it('[Q11] 3 consecutive failures flip status to paused with backoff; success recovers', async () => {
    const boom = new Error('net');
    const t = setup([boom, boom, boom, resp('2026-10-18T10:00:00.000Z')]);
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0); // fail 1 -> next in 4 s
    await vi.advanceTimersByTimeAsync(4000); // fail 2 -> 8 s
    await vi.advanceTimersByTimeAsync(8000); // fail 3 -> paused, 16 s
    expect(t.statuses).toEqual(['paused']);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(t.statuses).toEqual(['paused', 'live']);
    t.poller.stop();
  });
});
