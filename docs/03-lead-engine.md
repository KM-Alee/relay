# 03 — Lead Engine (Ownership, Routing, Acknowledgement, Escalation, Recovery)

> **Status:** Accepted spec. This is the heart of the product and of the P0 judging criteria. Requirement IDs: F3.1–F3.12, F1.8, F2.13, F5.1, Section 9, Section 10 "baseline acceptance checks".
> **Golden rule:** at every instant, every open lead has **exactly one active human** in `owner_user_id`. Every transition is one atomic, versioned, audited transaction.
> Code home: `packages/core/src/domain/leads/*` (pure decisions), `services/leads.ts` (use cases), `jobs/leadTimers.ts` (timer handlers).

## 1. Vocabulary (from requirements §9; do not invent synonyms)

- **Eligible handler**: an active user, `availability='available'`, open handler-lead count < capacity, team member, and matching skills when skill routing is on.
- **Handler custody** (`custody='handler'`): the owner is an eligible handler who was assigned the lead to work it.
- **Fallback custody** (`custody='fallback'`, `awaiting_handler=true`): the owner is the team's active **manager**, or the workspace **Owner** if there is no active manager. They are accountable for *monitoring and recovering* the lead. This is not a handling assignment: it does not count toward their capacity, it never acknowledges the lead, and it never stops routing retries. The custodian may be unavailable.
- **Acknowledged**: the *current human owner while in handler custody* clicked Acknowledge (app or Slack), or recorded a human action on the lead: note, outbound human message, call log, stage change, appointment created. **AI messages never count.** Actions by other users do not acknowledge.
- **Escalation**: an automatic owner transfer caused by an **expired acknowledgement window**. Only this increments `escalation_count`.
- **Overdue routing attempt**: a window expired but no transfer happened (nobody eligible). Increments `overdue_attempt_count`. This is not an escalation.
- **Idle re-trigger reassignment** (P1): a transfer caused by inactivity after acknowledgement. Increments `idle_retrigger_count` only.

Open handler-lead count for capacity = `count(leads WHERE owner_user_id = u AND custody='handler' AND status='open')`. *(Interpretation; see §11 Q1.)*

## 2. Lead states (derived from columns)

```
                         intake
                           │
          eligible found ──┴── nobody eligible / first-to-claim
                 ▼                         ▼
   ┌─────────────────────────┐   ┌──────────────────────────────┐
   │ HANDLER · PENDING       │   │ FALLBACK · PENDING           │
   │ countdown running       │   │ awaiting_handler, reason     │
   │ escalate_at set         │   │ escalate_at + routing_retry  │
   └──┬─────────┬────────────┘   └──┬──────────┬────────────────┘
 ack/ │ window  │ owner absent/     │ eligible │ claim (first-to-claim
action│ expires │ deactivated       │ appears  │ or pond)
      │   ▼     ▼                   │ (retry)  ▼
      │ escalation → next eligible  ▼     HANDLER · ACKNOWLEDGED
      │ or FALLBACK (overdue attempt)  HANDLER · PENDING
      ▼
   ┌────────────────────────────┐   idle ≥ idle_seconds → recovery queue (P0)
   │ HANDLER · ACKNOWLEDGED     │   + P1 idle re-trigger → back to routing
   └────────────────────────────┘
                     (any) ── close (won/lost/disqualified) ──► CLOSED (timers cleared)
```

UI labels (i18n keys `lead.state.*`): `awaitingHandler`, `assignedPending`, `overdue` (pending and `now > base_window_ends_at`), `critical`, `acknowledged`, `idle`, `closed`.

## 3. Configuration (per team; all seconds; all scaled by time-warp)

| Setting | Default (demo seed) | Req |
|---|---|---|
| `routing_mode` | `round_robin` | F3.3 |
| `default_capacity` / `users.capacity` | 5 | F3.3 (b)(e) |
| `ack_window_seconds` | 120 (real use: 900) | F3.4 |
| `urgent_ack_window_seconds` | 45 | F3.12 |
| `routing_retry_seconds` | 30 | F3.3 |
| `idle_seconds` | 600 | F3.7, F3.10 |
| escalation policy | L1 next_eligible (120 s) → L2 next_eligible (120 s) → L3 team_backup (90 s) → L4 team_manager (90 s), `repeat_count=1` | F3.5 |
| `skills_routing` | off | F3.3 (d) |
| `ai_settings.trigger_unacked_seconds` | 20 | F6.2 |

The P0 settings form edits these values. The P1 policy builder edits `escalation_levels` visually.

## 4. Routing algorithm (`domain/leads/route.ts`, pure)

```ts
route(input: {
  lead, team, members: Member[],   // with availability, isActive, openHandlerCount, capacity, skills
  mode: 'intake'|'escalation'|'retry'|'absence'|'idle_retrigger',
  level?: EscalationLevel, triedThisCycle: Set<UserId>, rrCursor: number, now
}): RoutingDecision
// RoutingDecision =
//  | { kind:'assign', toUserId, custody:'handler', trace, newRrCursor }
//  | { kind:'fallback', toUserId /* manager or owner */, reason, trace }
//  | { kind:'broadcast_claim', fallbackUserId, notifyUserIds, trace }   // first-to-claim
```

Steps:
1. Build the candidate list in `team_members.position` order. Rotate it to start after `rrCursor`.
2. For each candidate, record a trace entry. Skip with a reason, in this precedence: `inactive` → `on_leave` / `offline` / `busy` → `at_capacity` (show `5/5`) → `no_skill` → `already_tried` (escalation within the same cycle) → `current_owner`.
3. The level's `target_type` decides who is considered: `next_eligible` = the rotated list; `user` = that one user; `team_backup` / `team_manager` = that one user. A skipped specific target means "try the next level" (§5), and the skip reason is recorded.
4. `first_to_claim` mode at intake or retry: if ≥ 1 eligible user → `broadcast_claim` (lead stays in fallback custody with reason `first_to_claim_pending`). Otherwise → `fallback`.
5. Nobody eligible → `fallback` with reason `no_available` | `all_at_capacity` | `no_skill_match` (choose the dominant skip reason).
6. Fallback owner = `team.manager_user_id` if that user is active, else `workspace.owner_user_id`. Fallback ignores availability.

The trace is rendered as a sentence for humans, e.g. "Skipped Ali (On leave); skipped Sara (5/5 open leads); assigned Hamza (round-robin, next in rotation)", with i18n templates per reason (F3.11).

## 5. Transitions (`services/leads.ts`, each = one transaction)

All transitions follow the same shape:

```
withWorkspaceTx(ws, async tx => {
  lead = SELECT ... FROM leads WHERE id=$1 FOR UPDATE        // row lock
  guard(lead)                                                // state still valid? else no-op
  decision = domain.route(...) / domain.ack(...)
  UPDATE leads SET ..., version = version+1 WHERE id=$1 AND version=$v   // must hit 1 row
  INSERT lead_events, activities, notifications
  audit.append(...)                                          // F4.1
  outbox.enqueue('slack.send' | 'ai.*' | 'wake.schedule', dedupe_key per 04-integrations.md §7)
  realtime.emit(tx, {topic:'leads', ids:[lead.id]})
})
```

### T1. Intake (F3.1, I1.5)
Triggers: public form submit, inbound WhatsApp from a contact with no open lead, manual entry.
1. Upsert the contact by phone/email. If the contact already has an **open** lead, append the activity/message to it and stop (no new lead).
2. Insert the lead **with an owner already set**: run `route(mode:'intake')`. Never insert first and assign later.
3. Set `first_assigned_at = assigned_at = now`, `base_window_ends_at = now + window`, `ack_window_ends_at = escalate_at = now + window` (urgent → urgent window), and `escalation_level = 1`.
4. Fallback → also set `routing_retry_at = now + routing_retry_seconds`.
5. Event `intake_assigned` with trace. Notify the owner in-app. Slack alert outbox row (P0: all new assignments notify; required for escalations by F3.9). First-to-claim: notify each eligible user with a Claim action.
6. Form response: success confirmation regardless of routing outcome. P1 instant booking (I3.8) is offered only if custody = handler, the handler has a connected calendar, and Google is healthy.

### T2. Acknowledge (F3.4, I4.5, F2.13)
- Allowed if `ack_status='pending'`, `custody='handler'` and actor = owner. Via `app`, `slack`, or `action:<type>` (a note / call / human message / stage change / appointment created by the owner auto-acknowledges).
- Set `ack_status='acknowledged'`, `acknowledged_at=now`, `first_acknowledged_at = COALESCE(first_acknowledged_at, now)`, `last_human_action_at=now`. Clear `escalate_at` and `ack_window_ends_at`. Clear `is_critical`. If P1 F3.10 is enabled, set `idle_check_at = now + idle_seconds`.
- Stops the AI stand-in for the conversation (F6.10) through an outbox job `ai.handoff`.
- Stale or invalid attempt (not owner, already acked, lead moved): **no change**. Return `409 LEAD_STATE_CHANGED` with the current owner. The Slack interaction handler replies ephemerally (via `response_url`) to explain.

### T3. Acknowledgement window expiry → escalate (F3.5, F3.8, F3.9)
Timer: `escalate_at <= now`, `ack_status='pending'`, `status='open'`.
1. Lock the row. Re-check the guard (it may have been acked a millisecond ago → no-op).
2. Walk the levels starting at `escalation_level + 1`. For each level, `route(mode:'escalation', level)`. Take the first `assign` whose target ≠ current owner. Record skipped levels in the trace.
3. **Transfer found** → `custody='handler'`, owner = target, `escalation_count += 1`, `escalation_level = that level`, `assigned_at = now`, new window `escalate_at = now + level.timeout`, event `escalation`, Slack alert to the new owner (I4.1: within the same minute), in-app notification. `awaiting_handler=false`, `routing_retry_at = NULL`.
4. **No transfer possible on this pass** → `overdue_attempt` event, `overdue_attempt_count += 1`. Owner becomes or stays the fallback custodian (reason recorded; if this moves ownership off an unacked handler, emit `lead_events` type `overdue_attempt` with from/to so custody is visible). Next evaluation `escalate_at = now + current level timeout`. Set `routing_retry_at`.
5. **End of chain** (past the last level): `escalation_cycle += 1`. If `escalation_cycle < repeat_count`, restart at level 1. Otherwise mark **critical**: `is_critical=true`, `awaiting_reason='chain_exhausted'`, custody = fallback, alert the custodian in-app + Slack **even if unavailable**, event `critical_flagged`. Keep `routing_retry_at` running. `escalate_at` stays set at the retry cadence, so a newly available person still receives the lead (as `routing_retry_assigned`, not an escalation).

### T4. Routing retry (F3.3)
Timer `routing_retry_at <= now` while `awaiting_handler`. It is also kicked immediately (outbox `lead.retry_routing` for the team) when any user in the team becomes Available, when a lead closes, or when capacity changes.
- `route(mode:'retry')`. `assign` → handler custody, event `routing_retry_assigned`, fresh window, notify. **Not** an escalation and does not reset `first_assigned_at`. Still none → `routing_retry_at = now + retry`.

### T5. Absence (F3.6)
When a user's availability changes to `on_leave` or `offline`, in the **same transaction** as the status change:
- Every **pending** lead they own (handler custody) → `route(mode:'absence')` → eligible handler or fallback. Event `absence_reassign`. Not an escalation. Fresh window for the new owner.
- **Acknowledged** leads stay with them. A banner reads "Owner is absent; lead shown in recovery queue after idle period; managers can reassign" (i18n). P1 F3.10, if enabled, automates this after its timeout.
- `busy`: no reassignment; they simply stop being eligible.

### T6. Deactivation (F1.8)
Same transaction as `users.is_active=false`: revoke all sessions; transfer **every** open lead they own (pending, acknowledged, or held as fallback custodian) → route / fallback. Event `deactivation_reassign`. Blocked when the user is the configured fallback (team manager) without an active replacement, or is the workspace Owner.

### T7. Manual reassign (permission `leads.reassign`)
A manager picks the target. Default: eligible targets only. Choosing an ineligible user requires an explicit "override" checkbox with a recorded reason *(see §11 Q2)*. Event `manual_reassign`, fresh window, pending ack.

### T8. Claims (P1: first-to-claim F3.3c; pond claim F3.7)
Conditional update in one statement:
```sql
UPDATE leads SET owner_user_id=$me, custody='handler', awaiting_handler=false, awaiting_reason=NULL,
  ack_status='acknowledged', acknowledged_at=now(), acknowledged_via='claim',
  first_acknowledged_at=COALESCE(first_acknowledged_at, now()), assigned_at=now(),
  escalate_at=NULL, routing_retry_at=NULL, version=version+1
WHERE id=$id AND version=$v AND status='open' AND <claimable predicate>
RETURNING *;
```
Before the update, check the claimer's eligibility in the same tx with `FOR UPDATE` on the user row, so the capacity check is serialized. 0 rows → `claim_rejected` event + `409 ALREADY_CLAIMED` (losing claims change nothing). Pond claim uses the recovery-queue predicate (§7) and event `pond_claim`.

### T9. Idle (F3.7 P0 criterion; F3.10 P1)
- P0: an acknowledged lead whose `COALESCE(last_human_action_at, acknowledged_at) < now − idle_seconds` appears in the recovery queue (computed in the query, no timer needed).
- P1 (toggle `teams.idle_retrigger_enabled`): `idle_check_at` timer → if still idle, `route(mode:'idle_retrigger')`, event `idle_retrigger`, `idle_retrigger_count += 1`, `ack_status='pending'`, fresh window. `first_*` timestamps are unchanged. Every recorded human action pushes `idle_check_at` forward.

### T10. Human action recording (F2.13)
Any owner action (note, call log, outbound message, stage change, appointment) sets `last_human_action_at=now` and auto-acknowledges if pending. Actions by non-owners are logged but do not acknowledge.

### T11. Close
When the opportunity enters a won/lost stage, or the lead is disqualified or merged: `status='closed'`, clear all timers, event `closed`, kick routing retry for the team (capacity freed).

## 6. Timer processing (`core/jobs/leadTimers.ts`)

```sql
-- SECURITY DEFINER claim function (crosses workspaces, returns only ids)
SELECT id, workspace_id, version FROM leads
WHERE status='open' AND (escalate_at <= now() OR routing_retry_at <= now() OR idle_check_at <= now())
ORDER BY LEAST(escalate_at, routing_retry_at, idle_check_at)
FOR UPDATE SKIP LOCKED LIMIT 25;
```
For each id: open a `withWorkspaceTx`, re-lock the lead, re-check the guard, apply T3/T4/T9, then commit with the `version` check. Two ticks racing on the same lead: one gets the row, and the other skips it (SKIP LOCKED) or fails the version check. **Result: never escalated twice (F3.8).** A crash before commit rolls everything back, and the next tick redoes it exactly once (Q5).

After every transition that sets a deadline, call `scheduler.ensureWakeBy(deadline)`. It is an outbox job that schedules a QStash call if `deadline < scheduler_state.next_wake_at` (architecture §6).

## 7. Recovery queue (F3.7) — single SQL definition in `repos/recoveryQueue.ts`

A lead is listed (with every matching reason) when `status='open'` and any of:
- `R1 overdue`: `ack_status='pending' AND now() > base_window_ends_at`
- `R2 escalated2`: `escalation_count >= 2` (idle re-triggers excluded)
- `R3 idle`: `COALESCE(last_human_action_at, acknowledged_at, first_assigned_at) < now() − idle_seconds`
- `R4 awaiting`: `awaiting_handler` (shows the custodian + reason)
- `R5 critical`: `is_critical` (sorted first)

Sort: critical, then urgent, then oldest `first_assigned_at`. Visible with permission `leads.recovery.view`. The P1 pond Claim button is shown to eligible users.

## 8. Metrics (Section 9; implemented once in `domain/metrics` + `repos/metrics.ts`, used by every screen)

| Metric | Definition |
|---|---|
| New leads today | `leads.created_at` within today in the workspace timezone |
| Time to first response | `first_acknowledged_at − first_assigned_at`, average over leads first acknowledged in the period |
| Escalations (24 h) | `count(lead_events WHERE type='escalation' AND occurred_at > now()−24h)` |
| Idle re-triggers (24 h) (P1) | `type='idle_retrigger'`, separate figure |
| Recovery queue items | count of the §7 query |
| Revenue at risk (P1) | Σ over open, `ack_status='pending'` leads of `COALESCE(opportunity.value_minor, workspace.default_lead_value_minor)` |
| Revenue rescued (P1) | Collected revenue in the period from opportunities whose lead has `≥1 escalation` event with `occurred_at < first_acknowledged_at` |

Value figures are masked unless the viewer has `crm.opportunity.value.view` (F1.4).

## 9. Concurrency invariants (each one gets a test; see `08-testing.md`)

1. `owner_user_id` is never NULL (`NOT NULL` + intake inserts with an owner).
2. One owner at a time is inherent: it's a single column, and transfers are `UPDATE … WHERE version=$v`.
3. Two simultaneous timer evaluations → exactly one `escalation` event.
4. Two simultaneous claims → one winner, one `claim_rejected`, one owner.
5. Ack racing an escalation: whichever commits first wins, and the loser no-ops. A Slack ack after reassignment gets a "stale" reply.
6. Absence, deactivation and chain exhaustion never leave a live lead ownerless or with an inactive owner.
7. An idle re-trigger never changes `escalation_count`, `first_assigned_at` or `first_acknowledged_at`.

## 10. Notifications produced by the engine

| Event | In-app | Slack (I4) |
|---|---|---|
| intake/retry/manual assignment | owner | owner (baseline alert) |
| escalation | new owner | new owner, **within the same minute** (I4.1), with name, source, reason, link; P1 AI brief + Acknowledge button |
| first-to-claim broadcast | eligible users | eligible users with Claim button |
| critical (chain exhausted) | custodian | custodian, even if unavailable |
| absence/deactivation transfer | new owner | new owner |

A Slack alert **never waits** for AI. The brief is attached only if it is already available within ~1.5 s (F9.2); otherwise the baseline alert is sent.

## 11. Resolved decisions (final; build exactly this)

- **Q1** Fallback custody does **not** count toward the custodian's capacity, because custody isn't a handling assignment.
- **Q2** A manager may manually assign to an ineligible user (e.g. Busy) **only with an explicit override + reason**, which is audited.
- **Q3** The fallback custodian works a lead via **"Take over"**, allowed only if they are eligible, or via the manual-reassign override. Their notes on a lead they hold only as fallback are logged but don't acknowledge it.
- **Q4** Slack alerts go out on **every** assignment. Escalation alerts are mandatory (F3.9).
- **Q5** A returning customer whose lead is closed gets a **new lead** on the same contact.
- **Q6 (OQ-11) No bounce between a handler and the custodian.** When a window expires, no *other* eligible handler exists and the current owner (handler custody) is still eligible (active, Available, below capacity excluding this lead), the lead **stays with that owner**: handler custody, still pending, `overdue_attempt` event (meta `kept: true`), `overdue_attempt_count += 1`, `escalation_level = 0`, a new window (level 1 timeout, or the retry cadence once the chain is exhausted). At end of chain it is flagged **critical** (owner + custodian alerted) and stays in the recovery queue (R1 overdue, R5 critical). While kept-critical, `escalate_at` runs at the retry cadence: another eligible handler → `routing_retry_assigned` (fresh window, not an escalation); nobody → silent reschedule; owner no longer eligible (e.g. Busy) → fallback custody (`chain_exhausted`) recorded as an overdue attempt with from/to. `escalation_count` still moves only on real ack-timeout transfers. Applies to every handler (intake-, retry- or manually-assigned), not only retry-assigned ones.
- **Q7 (OQ-8..10)** accepted as documented in STATUS (named targets need not be team members; restart after a pass with no transfer; idle re-trigger restarts the chain). "Take over" uses the same rule as named targets: the custodian must be eligible but need not be a team member.

