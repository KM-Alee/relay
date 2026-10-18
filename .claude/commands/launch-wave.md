---
description: Orchestrate a build wave — claim lane tasks and launch one subagent per lane in isolated worktrees
argument-hint: <wave e.g. W2> [lanes e.g. A,B,C,D,Q]
---
Launch wave **$ARGUMENTS** of Relay.

1. Read `AGENTS.md`, `docs/13-parallel-development.md` (lanes, ownership, kickoff prompts in §9), `docs/09-build-plan.md` §0 (wave table + gate) and `STATUS.md`.
2. Verify that the **previous wave's gate** passed (STATUS session log / tasks `done`). If not, stop and report what's missing. Don't launch.
3. For each lane in this wave (default: all lanes listed for the wave): pick its tasks from STATUS (`Wave` = this wave, `Lane` = lane, status `todo`, dependencies `done`). Claim them in `STATUS.md` (status `in-progress`, Owner `agent:lane-<X>`, branch `t-<id>-<slug>`).
4. Launch **one subagent per lane in a single message** (so they run concurrently) using the Agent tool with `isolation: "worktree"` and the matching `subagent_type`:
   A → `lead-engine-engineer` · B → `backend-engineer` · C → `integrations-engineer` (use `ai-engineer` for AI-only task lists) · D → `frontend-engineer` · Q → `qa-engineer`.
   Prompt each with the §9 kickoff template filled in (lane, wave, ordered task IDs) plus the lane-specific reminder.
5. While they run, don't duplicate their work. When each finishes, run the `reviewer` subagent on its branch and summarize the findings.
6. At the end: update `STATUS.md` (statuses, session log), list PRs/branches ready to merge in the correct merge order (contracts → schema → services → UI), and state the gate check to run next.
