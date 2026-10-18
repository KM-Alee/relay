# ADR-0010: Parallel development with lanes, contracts-first, conflict-free layout

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** Q14 (structure), and delivery speed for the whole of §10

## Context
Time is short. We want 4–5 AI agents plus humans building at the same time. Without structure, agents collide on the same files (migrations, i18n JSON, nav, permissions) and block each other on missing APIs.

## Decision
- **Vertical lanes** A (lead engine), B (platform + CRM), C (integrations + AI), D (experience/design system), Q (QA/review), with a file-ownership map (`docs/13-parallel-development.md` §2).
- **Waves** with demoable gates (`docs/09-build-plan.md` §0).
- **Contracts-first**: Zod contracts + fixtures merged within about an hour of a wave starting. The UI builds in fixture mode.
- **Conflict-free layout** from day one: timestamped migrations, schema/i18n/contracts/seeds/job handlers split per domain, a complete permission catalogue and nav with stub pages created in W0.
- One worktree + branch + database + port per task (`scripts/wt.sh`). Small PRs. Stop-the-line on a red main.

## Consequences
- W0 takes slightly longer (the T-013 parallel-ready skeleton), but every later wave can run 4–5 agents.
- Some duplication in fixtures, accepted.
- Cross-lane edits need coordination via STATUS notes.

## Alternatives considered
- Horizontal layers (backend team vs frontend team): the UI lane becomes a bottleneck, with constant handoffs.
- Feature flags only, everyone on main: too many conflicts with AI agents editing in parallel.
