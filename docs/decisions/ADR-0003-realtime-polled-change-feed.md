# ADR-0003: Realtime via a polled change feed

- **Status:** Accepted (revised 2026-10-18: Ably dropped to save setup time)
- **Date:** 2026-10-18
- **Requirements touched:** Q11, F5.6, F1.4, F1.6

## Context
New leads, escalations, messages, AI activity and payments must appear without a manual refresh (Q11). Vercel functions can't hold WebSockets, and Neon's pooler doesn't support `LISTEN/NOTIFY`. Time is short, so every extra account or SDK costs us.

## Decision
- Every state-changing transaction calls `realtime.emit(tx, {topic, ids})`. That inserts a tiny `realtime_events` row (no record data) in the same transaction.
- The client polls `GET /api/v1/changes?since=<server time>` every 2 s, or every 1 s while Lead Radar or a countdown is visible, and pauses while the tab is hidden. It dedupes by event id and calls `queryClient.invalidateQueries` for each topic. The data itself is refetched through the permissioned API.
- The query overlaps 5 s back so out-of-order commits are never missed. `runDueWork()` prunes rows older than 10 min.

## Consequences
- No extra account, SDK or token endpoint. It works identically locally, in tests and on Vercel.
- Masking and visibility stay in one place, the API. The feed is RLS-scoped and carries no data.
- Latency is ≤ 1–2 s, which is fine for the demo. Open tabs keep Neon awake; that's acceptable for the hackathon.
- A push provider (Ably/Pusher) can be added later behind `RealtimeFeed` without touching services.

## Alternatives considered
- Ably / Pusher push: about 1 s faster, but one more account, token auth and CSP entries. Deferred.
- SSE route polling the DB server-side: long-lived functions burn compute and hit duration limits.
- Plain `refetchInterval` on every query: simpler still, but N queries per tab per interval instead of one cheap feed query.
