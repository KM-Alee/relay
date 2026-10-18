# ADR-0005: Tenant isolation with RLS on Neon's pooler

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** F1.6, Q2, F4.3

## Context
Workspace isolation must be enforced in app code **and** by database row-level security. Neon's pooled endpoint is PgBouncer in transaction mode, so session-level state is lost between transactions. Neon's default owner role belongs to `neon_superuser` and bypasses RLS.

## Decision
- The runtime connects as `app_user`, which has `NOBYPASSRLS` and doesn't own tables. Migrations run as the owner over the unpooled URL.
- Every workspace table has `ENABLE` + `FORCE ROW LEVEL SECURITY` with the policy `workspace_id = current_setting('app.workspace_id', true)::uuid`.
- `withWorkspaceTx(ws, fn)` runs `select set_config('app.workspace_id', ws, true)` (transaction-local) as the first statement. Queries outside it see zero rows.
- Cross-workspace needs (login by email, session resolution, webhook connection-key lookup, timer/outbox claims, public form by slug) use a small set of `SECURITY DEFINER` functions with pinned `search_path` that return minimal columns.
- `app_user` has no UPDATE/DELETE/TRUNCATE on `audit_events` (F4.3).
- Composite foreign keys `(workspace_id, id)` prevent cross-tenant references.

## Consequences
- Forgetting `withWorkspaceTx` fails closed (empty results), not open.
- No `LISTEN`, no session advisory locks, no plain `SET` at runtime.

## Alternatives considered
- App-level filtering only: fails the "second layer" requirement.
- Schema-per-tenant: heavy for a hackathon, and migrations multiply.
