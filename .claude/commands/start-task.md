---
description: Claim a task from STATUS.md, load the right docs, and produce an implementation plan
argument-hint: <T-id e.g. T-124>
---
Start task **$ARGUMENTS**.

1. Read `AGENTS.md` and `STATUS.md`. Find $ARGUMENTS in the board and its definition in `docs/09-build-plan.md` (requirement IDs, dependencies, "Done when").
2. If any dependency is not `done`, stop and report which ones. Suggest an unblocked alternative task instead.
3. If it is unclaimed, claim it in `STATUS.md`: status `in-progress`, Owner = you (or the user's name if given), branch `t-<id>-<slug>`. If a git repo exists, create the branch (or a worktree for parallel work).
4. Read the docs mapped to this area in `AGENTS.md` §2, plus each referenced requirement row in `requirements.md`. For UI tasks, check `docs/design/`.
5. Output a concise plan:
   - requirement IDs → the acceptance criteria you will satisfy
   - files to create/change (by layer: domain / services / repos / routes / UI / migrations)
   - tests to add (titles with requirement IDs), including concurrency/permission/RTL cases where relevant
   - docs to update
   - open questions (check `STATUS.md → Open questions` first; use the documented defaults)
6. Then implement, unless the user asked for the plan only.
