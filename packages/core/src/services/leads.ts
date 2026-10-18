// Leads use cases (docs/03-lead-engine.md §5). Owner: Lane A.
// T1 intake (manual + public form), T2 acknowledge, T10 human-action hook, T3/T4/T9 timer handling,
// list/detail with record visibility (06 §2). Decisions are pure (core/domain/leads); this file only
// locks, loads, persists (./lead-engine.ts).
import type {
  CreateLeadInput,
  LeadDetail,
  LeadEventDto,
  LeadSummary,
  PublicFormSubmit,
} from '@relay/contracts/api/leads';
import { leads } from '@relay/db/schema';
import { withSystemTx, withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { systemActor, type AuditActor } from '../audit/index';
import { clock } from '../clock';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { foundOr404, leadScopeSql } from '../auth/visibility';
import {
  REJECTION_ERROR,
  acknowledge as decideAck,
  escalateOnAckTimeout,
  idleRetrigger,
  intake as decideIntake,
  leadStateLabel,
  recordHumanAction as decideHumanAction,
  retryRouting,
  type HumanActionType,
  type LeadSnapshot,
  type Rejected,
  type TransitionResult,
} from '../domain/leads';
import { AppError, notFound } from '../errors';
import { uuidv7 } from '../ids';
import * as leadsRepo from '../repos/leads';
import * as teamsRepo from '../repos/teams';
import { dbNow, labelsOf, loadEngine, persist, type LoadedEngine } from './lead-engine';

const iso = (d: Date) => d.toISOString();
const isoN = (d: Date | null) => (d ? d.toISOString() : null);

function rejection(r: Rejected): AppError {
  return new AppError(REJECTION_ERROR[r.code], {
    details: { reason: r.code, currentOwnerUserId: r.currentOwnerUserId, ...(r.detail ?? {}) },
  });
}

// ── DTOs ────────────────────────────────────────────────────────────────

async function nameMap(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (!uniq.length) return new Map();
  const res = await tx.execute<{ id: string; name: string }>(
    sql`select id, name from users where id = any(${`{${uniq.join(',')}}`}::uuid[])`,
  );
  return new Map(res.rows.map((r) => [r.id, r.name]));
}

function toSummary(
  row: leadsRepo.LeadRow,
  names: Map<string, string>,
  actorUserId: string,
  idleSeconds: number,
  warpDeadline: (f: Date, s: number) => Date,
  now: Date,
): LeadSummary {
  const s = leadsRepo.toSnapshot(row);
  return {
    id: row.id,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    sourceKind: row.sourceKind,
    sourceLabel: row.sourceLabel,
    status: row.status,
    state: leadStateLabel(s, { now, deadline: warpDeadline, idleSeconds }),
    owner: { id: row.ownerUserId, name: names.get(row.ownerUserId) ?? '' },
    custody: row.custody,
    awaitingHandler: row.awaitingHandler,
    awaitingReason: s.awaitingReason,
    ackStatus: row.ackStatus,
    isUrgent: row.isUrgent,
    isCritical: row.isCritical,
    escalationLevel: row.escalationLevel,
    escalationCount: row.escalationCount,
    overdueAttemptCount: row.overdueAttemptCount,
    idleRetriggerCount: row.idleRetriggerCount,
    ackWindowEndsAt: isoN(row.ackWindowEndsAt),
    firstAssignedAt: iso(row.firstAssignedAt),
    assignedAt: iso(row.assignedAt),
    acknowledgedAt: isoN(row.acknowledgedAt),
    createdAt: iso(row.createdAt),
    version: row.version,
    canAcknowledge:
      row.status === 'open' &&
      row.custody === 'handler' &&
      row.ackStatus === 'pending' &&
      row.ownerUserId === actorUserId,
  };
}

interface ViewCtx {
  idleSeconds: Map<string, number>;
  deadline: (f: Date, s: number) => Date;
  now: Date;
}

async function viewCtx(tx: Tx, workspaceId: string): Promise<ViewCtx> {
  const ws = await teamsRepo.workspaceRouting(tx, workspaceId);
  const teams = await teamsRepo.listTeams(tx);
  const warp = { timeWarpMultiplier: ws?.timeWarpMultiplier ?? 1 };
  return {
    idleSeconds: new Map(teams.map((t) => [t.id, t.idleSeconds])),
    deadline: (f, s) => clock.deadline(warp, s, f),
    now: await dbNow(tx),
  };
}

async function detailOf(tx: Tx, row: leadsRepo.LeadRow, actorUserId: string): Promise<LeadDetail> {
  const events = await leadsRepo.listEvents(tx, row.id);
  const names = await nameMap(tx, [row.ownerUserId, ...events.flatMap((e) => [e.fromUserId, e.toUserId])]);
  const v = await viewCtx(tx, row.workspaceId);
  const ref = (id: string | null) => (id ? { id, name: names.get(id) ?? '' } : null);
  return {
    ...toSummary(row, names, actorUserId, v.idleSeconds.get(row.teamId) ?? 600, v.deadline, v.now),
    message: row.message,
    baseWindowEndsAt: iso(row.baseWindowEndsAt),
    events: events.map((e): LeadEventDto => ({
      id: e.id,
      type: e.type,
      from: ref(e.fromUserId),
      to: ref(e.toUserId),
      custody: (e.custody as LeadEventDto['custody']) ?? null,
      escalationLevel: e.escalationLevel,
      trace: (e.trace as LeadEventDto['trace']) ?? null,
      meta: (e.meta as LeadEventDto['meta']) ?? null,
      actorType: e.actorType,
      occurredAt: iso(e.occurredAt),
    })),
  };
}

// ── T1 intake ───────────────────────────────────────────────────────────

export interface IntakeRequest {
  workspaceId: string;
  teamId?: string | null;
  contact: { id?: string | null; name: string; phone?: string | null; email?: string | null };
  message?: string | null;
  source: { kind: 'web_form' | 'whatsapp' | 'manual'; id?: string | null; label: string };
  isUrgent?: boolean;
  actor: AuditActor;
}

export interface IntakeOutcome {
  leadId: string;
  /** false → the contact already had an open lead; nothing new was created (03 T1 step 1). */
  created: boolean;
  custody: 'handler' | 'fallback';
}

/**
 * T1 inside the caller's tx (WhatsApp inbound, Lane C, calls this with its own tx).
 * The lead is INSERTED with its owner already decided; never insert-then-assign.
 */
export async function intakeInTx(tx: Tx, req: IntakeRequest): Promise<IntakeOutcome> {
  const phone = req.contact.phone?.trim() || null;
  const email = req.contact.email?.trim().toLowerCase() || null;
  const team = req.teamId ? await teamsRepo.getTeam(tx, req.teamId) : await teamsRepo.defaultTeam(tx);
  if (!team) throw notFound({ what: 'team' });
  const existing = await leadsRepo.findOpenForContact(tx, {
    contactId: req.contact.id ?? null,
    phone,
    email,
  });
  if (existing) return { leadId: existing.id, created: false, custody: existing.custody };

  const now = await dbNow(tx);
  const eng = await loadEngine(tx, req.workspaceId, team.id, now);
  const r = decideIntake(eng.ctx, {
    id: uuidv7(),
    workspaceId: req.workspaceId,
    isUrgent: req.isUrgent ?? false,
    actor: 'type' in req.actor ? { type: 'system' } : { type: 'user', userId: req.actor.userId },
  });
  const labels = { contactName: req.contact.name, sourceLabel: req.source.label };
  await persist(tx, eng, null, r, {
    actor: req.actor,
    labels,
    extras: {
      contactId: req.contact.id ?? null,
      contactName: req.contact.name,
      contactPhone: phone,
      contactEmail: email,
      message: req.message ?? null,
      sourceKind: req.source.kind,
      sourceId: req.source.id ?? null,
      sourceLabel: req.source.label,
      urgentSource: req.isUrgent ? 'manual' : null,
    },
  });
  return { leadId: r.next.id, created: true, custody: r.next.custody };
}

/** POST /api/v1/leads (leads.create): manual entry with a configured source (F3.1). */
export async function createManual(
  actor: Actor,
  input: CreateLeadInput,
  opts: TxOptions = {},
): Promise<LeadDetail> {
  assertPermission(actor, 'leads.create');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const sources = await teamsRepo.listLeadSources(tx);
      const src = sources.find((s) => s.key === input.sourceKey && s.kind === 'manual');
      if (!src)
        throw new AppError('VALIDATION_FAILED', {
          details: { in: 'body', issues: [{ path: 'sourceKey', code: 'unknown_source' }] },
        });
      const out = await intakeInTx(tx, {
        workspaceId: actor.workspaceId,
        teamId: input.teamId ?? null,
        contact: { name: input.contactName, phone: input.phone, email: input.email },
        message: input.message,
        source: { kind: 'manual', id: src.id, label: src.label },
        isUrgent: input.isUrgent,
        actor,
      });
      const row = await leadsRepo.getLead(tx, out.leadId);
      return detailOf(tx, foundOr404(row), actor.userId);
    },
    opts,
  );
}

/** GET /f/:slug data (no session): the form title only. */
export async function getPublicForm(slug: string, opts: TxOptions = {}): Promise<{ title: string } | null> {
  const found = await withSystemTx((tx) => teamsRepo.lookupWebForm(tx, slug), opts);
  if (!found) return null;
  return withWorkspaceTx(
    found.workspaceId,
    async (tx) => {
      const f = await teamsRepo.getWebForm(tx, found.formId);
      return f ? { title: f.title } : null;
    },
    opts,
  );
}

/**
 * POST /api/public/forms/:slug (F3.1): honeypot + server validation (route) + per-IP limit (route).
 * The answer is the same whatever the routing outcome (03 T1 step 6). A filled honeypot is accepted
 * silently and creates nothing.
 */
export async function submitPublicForm(
  slug: string,
  body: PublicFormSubmit,
  opts: TxOptions = {},
): Promise<{ ok: true; bookingAvailable: boolean }> {
  if (body.website) return { ok: true, bookingAvailable: false };
  const found = await withSystemTx((tx) => teamsRepo.lookupWebForm(tx, slug), opts);
  if (!found) throw notFound();
  await withWorkspaceTx(
    found.workspaceId,
    async (tx) => {
      const form = foundOr404(await teamsRepo.getWebForm(tx, found.formId));
      await intakeInTx(tx, {
        workspaceId: found.workspaceId,
        teamId: form.teamId,
        contact: { name: body.name, phone: body.phone, email: body.email || null },
        message: body.message ?? null,
        source: { kind: 'web_form', id: form.id, label: form.title },
        actor: systemActor(found.workspaceId),
      });
    },
    opts,
  );
  // P1 instant booking (I3.8) is offered only with handler custody + a connected calendar (T-144/T-2xx).
  return { ok: true, bookingAvailable: false };
}

// ── shared transition runner ────────────────────────────────────────────

/**
 * Lock the lead, load the engine, decide, persist. Returns the result (rejections are NOT thrown,
 * so timer callers can no-op). Must be called inside withWorkspaceTx.
 */
export async function runTransition(
  tx: Tx,
  leadId: string,
  decide: (eng: LoadedEngine, lead: LeadSnapshot, tx: Tx) => Promise<TransitionResult> | TransitionResult,
  o: { actor: AuditActor; extraPeople?: readonly string[] },
): Promise<{ row: leadsRepo.LeadRow; result: TransitionResult } | null> {
  const row = await leadsRepo.lockLead(tx, leadId);
  if (!row) return null;
  const now = await dbNow(tx);
  const eng = await loadEngine(tx, row.workspaceId, row.teamId, now, o.extraPeople);
  const lead = leadsRepo.toSnapshot(row);
  const result = await decide(eng, lead, tx);
  if (result.ok) {
    await persist(tx, eng, lead, result, { actor: o.actor, labels: labelsOf(row) });
  } else if (result.events.length) {
    await leadsRepo.insertEvents(tx, row.workspaceId, row.id, result.events); // claim_rejected
  }
  return { row, result };
}

// ── T2 acknowledge ──────────────────────────────────────────────────────

/** POST /api/v1/leads/:id/acknowledge. Not visible → 404; not owner / stale → 409 LEAD_STATE_CHANGED. */
export async function acknowledge(
  actor: Actor,
  leadId: string,
  input: { version?: number; via?: 'app' | 'slack' },
  opts: TxOptions = {},
): Promise<LeadDetail> {
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      foundOr404(await leadsRepo.getLead(tx, leadId, leadScopeSql(actor, leads.ownerUserId)));
      const out = await runTransition(
        tx,
        leadId,
        (eng, lead) =>
          decideAck(eng.ctx, lead, {
            actorUserId: actor.userId,
            via: input.via ?? 'app',
            expectedVersion: input.version,
          }),
        { actor },
      );
      if (!out) throw notFound();
      if (!out.result.ok) throw rejection(out.result);
      const row = foundOr404(await leadsRepo.getLead(tx, leadId));
      return detailOf(tx, row, actor.userId);
    },
    opts,
  );
}

// ── T10 human-action hook (Lane B: notes, call logs, stage changes; Lane C: outbound messages) ──

/**
 * Call INSIDE the transaction that records the human action. The owner (handler custody) auto-
 * acknowledges a pending lead; other users / fallback custodians are logged by the caller only.
 * Returns true if the lead changed.
 */
export async function recordHumanActionInTx(
  tx: Tx,
  actor: Actor,
  leadId: string,
  action: HumanActionType,
): Promise<boolean> {
  const out = await runTransition(
    tx,
    leadId,
    (eng, lead) => decideHumanAction(eng.ctx, lead, { actorUserId: actor.userId, action }),
    {
      actor,
    },
  );
  return !!out && out.result.ok && out.result.changed;
}

// ── T3 / T4 / T9 timers (core/jobs/lead-timers.ts) ──────────────────────

export type TimerOutcome = 'escalation' | 'overdue_attempt' | 'retry' | 'idle' | 'noop';

function pickTimer(eng: LoadedEngine, lead: LeadSnapshot, tried: string[]): TransitionResult {
  const now = eng.ctx.now;
  if (lead.ackStatus === 'pending' && lead.escalateAt && lead.escalateAt <= now) {
    return escalateOnAckTimeout(eng.ctx, lead, { triedThisCycle: tried });
  }
  if (lead.awaitingHandler && lead.routingRetryAt && lead.routingRetryAt <= now)
    return retryRouting(eng.ctx, lead);
  if (lead.idleCheckAt && lead.idleCheckAt <= now) return idleRetrigger(eng.ctx, lead);
  return { ok: false, code: 'NOT_DUE', currentOwnerUserId: lead.ownerUserId, events: [] };
}

/**
 * A due timer column whose transition no longer applies (e.g. idle check with the P1 flag off)
 * is cleared, so the claim query never spins on it.
 */
function staleTimerPatch(lead: LeadSnapshot, now: Date): Partial<LeadSnapshot> | null {
  const patch: Partial<LeadSnapshot> = {};
  if (lead.escalateAt && lead.escalateAt <= now && lead.ackStatus !== 'pending') patch.escalateAt = null;
  if (lead.routingRetryAt && lead.routingRetryAt <= now && !lead.awaitingHandler) patch.routingRetryAt = null;
  if (lead.idleCheckAt && lead.idleCheckAt <= now) patch.idleCheckAt = null;
  return Object.keys(patch).length ? patch : null;
}

/** Handle one claimed lead timer in its own workspace tx (03 §6). */
export async function processLeadTimer(
  workspaceId: string,
  leadId: string,
  opts: TxOptions = {},
): Promise<TimerOutcome> {
  return withWorkspaceTx(
    workspaceId,
    async (tx) => {
      const out = await runTransition(
        tx,
        leadId,
        async (eng, lead, t) => {
          if (lead.status !== 'open')
            return { ok: false, code: 'LEAD_CLOSED', currentOwnerUserId: lead.ownerUserId, events: [] };
          const tried = await leadsRepo.triedThisCycle(t, lead.id);
          const r = pickTimer(eng, lead, tried);
          if (!r.ok && r.code !== 'NOT_DUE') {
            const patch = staleTimerPatch(lead, eng.ctx.now);
            if (patch) await leadsRepo.updateLeadVersioned(t, lead.id, lead.version, patch);
          }
          return r;
        },
        { actor: systemActor(workspaceId) },
      );
      if (!out || !out.result.ok) return 'noop';
      const types = out.result.events.map((e) => e.type);
      if (types.includes('escalation')) return 'escalation';
      if (types.includes('overdue_attempt')) return 'overdue_attempt';
      if (types.includes('idle_retrigger')) return 'idle';
      return 'retry';
    },
    opts,
  );
}

/** T4 kick (`lead.retry_routing {teamId}`): retry every awaiting lead of the team, one tx each. */
export async function retryTeam(workspaceId: string, teamId: string, opts: TxOptions = {}): Promise<number> {
  const ids = await withWorkspaceTx(workspaceId, (tx) => leadsRepo.awaitingLeadIds(tx, teamId), opts);
  let assigned = 0;
  for (const id of ids) {
    const done = await withWorkspaceTx(
      workspaceId,
      async (tx) => {
        const out = await runTransition(
          tx,
          id,
          (eng, lead) => retryRouting(eng.ctx, lead, { kicked: true }),
          {
            actor: systemActor(workspaceId),
          },
        );
        return !!out?.result.ok && out.result.events.some((e) => e.type === 'routing_retry_assigned');
      },
      opts,
    );
    if (done) assigned++;
    else break; // nobody eligible for the oldest → nobody for the rest either
  }
  return assigned;
}

// ── reads ───────────────────────────────────────────────────────────────

export async function list(
  actor: Actor,
  q: { view?: 'mine' | 'all'; status?: 'open' | 'closed' | 'all'; cursor?: string; limit?: number },
  opts: TxOptions = {},
): Promise<{ items: LeadSummary[]; nextCursor: string | null }> {
  const limit = q.limit ?? 50;
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const mine = q.view !== 'all' || !can(actor, 'leads.view_all');
      const rows = await leadsRepo.listLeads(tx, {
        scope: leadScopeSql(actor, leads.ownerUserId),
        ownerUserId: mine ? actor.userId : undefined,
        status: q.status === 'all' ? undefined : (q.status ?? 'open'),
        before: q.cursor,
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const names = await nameMap(
        tx,
        page.map((r) => r.ownerUserId),
      );
      const v = await viewCtx(tx, actor.workspaceId);
      return {
        items: page.map((r) =>
          toSummary(r, names, actor.userId, v.idleSeconds.get(r.teamId) ?? 600, v.deadline, v.now),
        ),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    opts,
  );
}

export async function get(actor: Actor, id: string, opts: TxOptions = {}): Promise<LeadDetail> {
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const row = foundOr404(await leadsRepo.getLead(tx, id, leadScopeSql(actor, leads.ownerUserId)));
      return detailOf(tx, row, actor.userId);
    },
    opts,
  );
}

export async function sources(actor: Actor, opts: TxOptions = {}) {
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => ({
      items: (await teamsRepo.listLeadSources(tx))
        .filter((s) => s.kind === 'manual')
        .map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
    }),
    opts,
  );
}

export const leadsService = {
  createManual,
  acknowledge,
  list,
  get,
  sources,
  getPublicForm,
  submitPublicForm,
  processLeadTimer,
  retryTeam,
};
