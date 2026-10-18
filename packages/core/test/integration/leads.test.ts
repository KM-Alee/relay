// [F3.8] [Q5] [§9] Lead engine invariants on real Postgres, as app_user (docs/03-lead-engine.md §9).
// Each test owns a fresh workspace: Owner (offline, = team manager + backup) + members A and B.
import { randomUUID } from 'node:crypto';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor } from '../../src/audit/index';
import type { Actor } from '../../src/auth/actor';
import { provisionTeams } from '../../src/auth/provisioning-teams';
import { isAppError } from '../../src/errors';
import { runDueWork } from '../../src/jobs/run-due-work';
import * as teamsRepo from '../../src/repos/teams';
import { acknowledge, intakeInTx, processLeadTimer, submitPublicForm } from '../../src/services/leads';
import { setAvailability } from '../../src/services/teams';
import { owner } from '../helpers/jobs';

interface Fixture {
  ws: string;
  ownerId: string;
  a: string;
  b: string;
  slug: string;
}

async function fixture(): Promise<Fixture> {
  const ws = randomUUID();
  const [ownerId, a, b] = [randomUUID(), randomUUID(), randomUUID()];
  const slug = `t-${ws.slice(0, 8)}`;
  await withWorkspaceTx(ws, async (tx) => {
    await tx.execute(sql`insert into workspaces (id, name, slug) values (${ws}, 'Leads test', ${slug})`);
    const user = (id: string, name: string, level: string, availability: string) =>
      tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level, availability)
        values (${id}, ${ws}, ${`${id}@leads.test`}, ${name}, 'x', ${level}::user_base_level, ${availability}::user_availability)`);
    await user(ownerId, 'Owner', 'owner', 'offline');
    await user(a, 'Ali', 'user', 'available');
    await user(b, 'Sara', 'user', 'available');
    await tx.execute(sql`update workspaces set owner_user_id = ${ownerId} where id = ${ws}`);
    const { teamId } = await provisionTeams(tx, { workspaceId: ws, ownerUserId: ownerId, locale: 'en' });
    await teamsRepo.addMember(tx, { workspaceId: ws, teamId, userId: a });
    await teamsRepo.addMember(tx, { workspaceId: ws, teamId, userId: b });
  });
  return { ws, ownerId, a, b, slug };
}

const actorFor = (ws: string, userId: string): Actor => ({
  userId,
  workspaceId: ws,
  sessionId: randomUUID(),
  baseLevel: 'user',
  permissions: new Set(),
  locale: 'en',
});

async function newLead(f: Fixture, name = 'Customer'): Promise<string> {
  return withWorkspaceTx(f.ws, async (tx) => {
    const out = await intakeInTx(tx, {
      workspaceId: f.ws,
      contact: { name, phone: `+92300${Math.floor(Math.random() * 1e7)}` },
      source: { kind: 'manual', label: 'Walk-in' },
      actor: systemActor(f.ws),
    });
    return out.leadId;
  });
}

type LeadDb = {
  owner_user_id: string;
  custody: string;
  awaiting_reason: string | null;
  ack_status: string;
  escalation_count: number;
  overdue_attempt_count: number;
  is_critical: boolean;
  version: number;
};
const leadRow = async (id: string) => (await owner<LeadDb>(`select * from leads where id = $1`, [id]))[0]!;
const events = async (id: string) =>
  (
    await owner<{ type: string }>(
      `select type from lead_events where lead_id = $1 order by occurred_at, id`,
      [id],
    )
  ).map((e) => e.type);
const makeDue = (id: string) =>
  owner(`update leads set escalate_at = now() - interval '1 second' where id = $1`, [id]);
const ownerActive = async (id: string) =>
  (
    await owner<{ ok: boolean }>(
      `select u.is_active as ok from leads l join users u on u.id = l.owner_user_id where l.id = $1`,
      [id],
    )
  )[0]!.ok;

afterAll(async () => {
  await closeDb();
});

describe('lead engine on Postgres', () => {
  it('[F3.8] [§9.3] two timer ticks racing on the same due lead escalate it exactly once', async () => {
    const f = await fixture();
    const id = await newLead(f);
    expect((await leadRow(id)).owner_user_id).toBe(f.a);
    await makeDue(id);
    const tick = () => runDueWork({ trigger: 'dev', scope: { workspaceIds: [f.ws] }, scheduler: null });
    await Promise.all([tick(), tick(), processLeadTimer(f.ws, id).catch(() => 'lost')]);
    const row = await leadRow(id);
    expect(row).toMatchObject({ owner_user_id: f.b, escalation_count: 1, overdue_attempt_count: 0 });
    expect((await events(id)).filter((t) => t === 'escalation')).toHaveLength(1);
    // [F3.9] the new owner gets a Slack alert through the outbox, in the same transaction.
    const slack = await owner<{ payload: { purpose: string; userId: string } }>(
      `select payload from outbox where workspace_id = $1 and type = 'slack.send' and payload->>'purpose' = 'escalated'`,
      [f.ws],
    );
    expect(slack).toEqual([expect.objectContaining({ payload: expect.objectContaining({ userId: f.b }) })]);
  });

  it('[F3.4] [§9.5] two simultaneous acknowledgements: one winner, the loser gets LEAD_STATE_CHANGED', async () => {
    const f = await fixture();
    const id = await newLead(f);
    const results = await Promise.allSettled([
      acknowledge(actorFor(f.ws, f.a), id, {}),
      acknowledge(actorFor(f.ws, f.a), id, {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isAppError(lost.reason) && lost.reason.code).toBe('LEAD_STATE_CHANGED');
    expect((await events(id)).filter((t) => t === 'acknowledged')).toHaveLength(1);
  });

  it('[F3.4] [§9.5] ack racing the escalation timer: exactly one of them wins', async () => {
    const f = await fixture();
    const id = await newLead(f);
    await makeDue(id);
    const [ack] = await Promise.allSettled([
      acknowledge(actorFor(f.ws, f.a), id, {}),
      processLeadTimer(f.ws, id),
    ]);
    const ev = await events(id);
    const acked = ack.status === 'fulfilled';
    expect(ev.includes('acknowledged')).toBe(acked);
    expect(ev.includes('escalation')).toBe(!acked);
    expect((await leadRow(id)).escalation_count).toBe(acked ? 0 : 1);
  });

  it('[F3.4] ack by a non-owner → 409 LEAD_STATE_CHANGED and nothing changes', async () => {
    const f = await fixture();
    const id = await newLead(f);
    const before = await leadRow(id);
    await expect(acknowledge(actorFor(f.ws, f.b), id, {})).rejects.toMatchObject({ code: 'NOT_FOUND' }); // out of scope
    const viewAll: Actor = { ...actorFor(f.ws, f.b), permissions: new Set(['leads.view_all']) };
    await expect(acknowledge(viewAll, id, {})).rejects.toMatchObject({ code: 'LEAD_STATE_CHANGED' });
    expect((await leadRow(id)).version).toBe(before.version);
  });

  it('[§10a] [§9.1] [F3.1] public form with everyone offline → fallback custodian owns it with a visible reason', async () => {
    const f = await fixture();
    await owner(`update users set availability = 'offline' where workspace_id = $1`, [f.ws]);
    expect(await submitPublicForm(f.slug, { name: 'Web visitor', phone: '+923001112223' })).toEqual({
      ok: true,
      bookingAvailable: false,
    });
    const [lead] = await owner<LeadDb & { id: string }>(`select * from leads where workspace_id = $1`, [
      f.ws,
    ]);
    expect(lead).toMatchObject({
      owner_user_id: f.ownerId,
      custody: 'fallback',
      awaiting_reason: 'no_available',
    });
    // Honeypot: accepted silently, nothing created.
    await submitPublicForm(f.slug, { name: 'Bot', phone: '+923009999999', website: 'spam' });
    expect(await owner(`select id from leads where workspace_id = $1`, [f.ws])).toHaveLength(1);
  });

  it('[§10c] [§9.6] absence and chain exhaustion never leave a live lead ownerless or with an inactive owner', async () => {
    const f = await fixture();
    const id = await newLead(f);
    expect((await leadRow(id)).owner_user_id).toBe(f.a);

    // T5 absence: Ali goes on leave → pending lead moves to Sara (not an escalation).
    const r = await setAvailability(actorFor(f.ws, f.a), f.a, 'on_leave');
    expect(r.reassignedLeadIds).toEqual([id]);
    expect(await leadRow(id)).toMatchObject({ owner_user_id: f.b, escalation_count: 0 });

    // Window expires: L2 next_eligible has nobody (Ali away), L3 backup / L4 manager = offline Owner
    // → overdue attempt, fallback custody, chain exhausted → critical. Owner never null.
    await makeDue(id);
    await processLeadTimer(f.ws, id);
    expect(await leadRow(id)).toMatchObject({
      owner_user_id: f.ownerId,
      custody: 'fallback',
      awaiting_reason: 'chain_exhausted',
      is_critical: true,
      escalation_count: 0,
      overdue_attempt_count: 1,
    });
    expect(await ownerActive(id)).toBe(true);
    expect(await events(id)).toEqual([
      'intake_assigned',
      'absence_reassign',
      'overdue_attempt',
      'critical_flagged',
    ]);

    // Someone becomes available → routing retry assigns them (not an escalation), critical cleared.
    await setAvailability(actorFor(f.ws, f.a), f.a, 'available');
    await runDueWork({ trigger: 'dev', scope: { workspaceIds: [f.ws] }, scheduler: null });
    expect(await leadRow(id)).toMatchObject({
      owner_user_id: f.a,
      custody: 'handler',
      escalation_count: 0,
      is_critical: false,
    });
  });
});
