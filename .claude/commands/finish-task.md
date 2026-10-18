---
description: Run the Definition-of-Done gate for the current task and update STATUS.md and CHANGELOG.md
argument-hint: [T-id]
---
Finish task $ARGUMENTS (if no ID is given, infer it from the branch name or the in-progress task in STATUS.md that you own).

1. Run `pnpm check` (lint, typecheck, tests). Report the **real** output summary. If something can't run (no DB, no script yet), say so explicitly. Don't claim a pass.
2. Walk the Definition of Done in `AGENTS.md` §6 item by item, answering each with yes / no / n.a. plus evidence (file:line or test name).
3. Verify the docs are in sync per `docs/10-conventions.md` §5: schema → 02, lead behaviour → 03, endpoints → 11, env → `.env.example` + 12, permissions → 06 §2, decisions → ADR.
4. Update `STATUS.md`: task → `review` (or `done` if reviewed and merged), notes, and an entry in the Session log (2–4 lines).
5. Add a `CHANGELOG.md` line under `[Unreleased]`: `- <user-visible change> [T-xxx] [Req-IDs]`.
6. Propose a Conventional Commit message `type(scope): summary [T-xxx] [Req-IDs]`. Commit only if the user asked you to.
7. Suggest running the `reviewer` subagent on the diff before merge.
