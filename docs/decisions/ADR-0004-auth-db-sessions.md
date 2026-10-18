# ADR-0004: Own DB-backed sessions; one workspace per user

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** F1.1, F1.2, F1.8, Q1

## Context
Requirements: list active sessions, end any of them, end all sessions immediately on deactivation, rate-limit login, and use argon2id or bcrypt.

## Decision
- Random 32-byte session token in an httpOnly Secure SameSite=Lax cookie. The DB stores only its SHA-256 (`sessions.token_hash`). Each request is validated against the DB, so revocation takes effect immediately.
- Passwords hashed with argon2id (`@node-rs/argon2`).
- **A user account belongs to exactly one workspace; email is globally unique.** Login therefore needs no workspace selector. Seeded demo workspaces use distinct emails.

## Consequences
- One DB lookup per request (indexed, fast on the pooled connection).
- A person who needs two workspaces uses two emails (acceptable for the hackathon; revisit with a memberships table later).

## Alternatives considered
- JWT: can't be revoked instantly without a denylist, which would be a DB lookup anyway.
- Auth.js / Better Auth: extra abstraction around custom permissions and RLS; possible later.
