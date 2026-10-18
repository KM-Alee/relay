---
description: Draft a new Architecture Decision Record
argument-hint: <short title>
---
Create a new ADR titled "$ARGUMENTS".

1. Look in `docs/decisions/` for the next free number (ADR-NNNN) and copy `ADR-template.md`.
2. Fill in Context (with requirement IDs), Decision, Consequences and Alternatives, based on the current conversation and the relevant docs. Status: `Proposed`, unless the user has explicitly accepted it.
3. If it supersedes an ADR, mark the old one `Superseded by ADR-NNNN`.
4. Add a row to `docs/decisions/README.md`.
5. List the docs that must change if it's accepted (e.g. `01-architecture.md` §x), and update them only if the user accepts.
