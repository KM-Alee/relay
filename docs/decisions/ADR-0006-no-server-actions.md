# ADR-0006: One mutation path, `/api/v1` route handlers (no Server Actions)

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** F1.5, Q2, Q3, F10.1

## Context
Authorization must be enforced server-side and be demonstrable with direct API calls. Server Actions add a second, less visible mutation surface with its own CSRF semantics.

## Decision
All mutations go through `/api/v1/*` route handlers built with the shared `route()` wrapper (session → actor → CSRF → Zod → one service). Server Components may *read* through services. Client components mutate through TanStack Query mutations.

## Consequences
- A single place enforces auth, CSRF, rate limits and error mapping. The Judge Console can hit the same endpoints a browser uses.
- Slightly more boilerplate than Server Actions.

## Alternatives considered
- Server Actions everywhere: harder to audit and to prove F1.5.
- tRPC: fine, but adds a dependency; Zod contracts + fetch are enough.
