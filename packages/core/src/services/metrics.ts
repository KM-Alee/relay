// Dashboard metrics service (F5.1-F5.8). Owner: Lane D (T-150, T-201).
// Role-aware (F5.4): `dashboard.company` -> workspace-wide, otherwise the actor's own leads. Every money
// figure goes through core/auth/mask.ts. Row-level scope (leads.view_all) is applied inside the repos.
import type { OverviewQuery, OverviewResponse, RadarResponse } from '@relay/contracts/api/dashboard';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import type { Actor } from '../auth/actor';
import { canSeeValue, maskMoneyFigure } from '../auth/mask';
import { can } from '../auth/permissions';
import * as repo from '../repos/metrics';

const SPARK_DAYS = 7;

/** Actor narrowed to the personal scope when they lack company-wide dashboard access. */
function scopeOf(actor: Actor): OverviewResponse['scope'] {
  return can(actor, 'dashboard.company') ? 'company' : 'mine';
}

/** Without company scope, leads are restricted to the actor's own, regardless of leads.view_all. */
function effectiveActor(actor: Actor): Actor {
  if (scopeOf(actor) === 'company') return actor;
  const permissions = new Set(actor.permissions);
  permissions.delete('leads.view_all');
  return { ...actor, baseLevel: actor.baseLevel === 'owner' ? 'user' : actor.baseLevel, permissions };
}

export async function overview(
  actorIn: Actor,
  query: OverviewQuery = {},
  opts: TxOptions = {},
): Promise<OverviewResponse> {
  const days = query.days ?? 30;
  const scope = scopeOf(actorIn);
  const actor = effectiveActor(actorIn);
  const showValues = canSeeValue(actorIn);

  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const ws = await repo.workspaceCurrency(tx, actor.workspaceId);
      const today = await repo.localToday(tx, ws.timezone);
      const span = Math.max(days, SPARK_DAYS);
      // Sequential on purpose: guarded() queries use savepoints on this one transaction.
      const newLeads = await repo.newLeadsPerDay(tx, actor, ws.timezone, SPARK_DAYS, today);
      const response = await repo.firstResponsePerDay(tx, actor, ws.timezone, SPARK_DAYS, today);
      const recovery = await repo.recoveryQueueCounts(tx, actor);
      const attention = await repo.attentionCounts(tx, actor, ws.timezone);
      const esc = await repo.escalations24h(tx, actor);
      const team = await repo.teamAvailability(tx, actor.workspaceId);
      const stages = await repo.pipelineByStage(tx, actor);
      const appts = await repo.upcomingAppointments(tx, actor);
      const perDay = await repo.leadsAndEscalationsPerDay(tx, actor, ws.timezone, span, today);
      const paid = await repo.collectedPerDay(tx, actor, ws.timezone, days, today);
      const atRisk = scope === 'company' ? await repo.revenueAtRiskMinor(tx, actor) : null;
      const rescued = scope === 'company' ? await repo.revenueRescuedMinor(tx, actor, ws.timezone) : null;

      const nl = newLeads.map((d) => d.value);
      const rs = response.series.map((d) => d.value);
      const totalCollected = paid.collected.reduce((s, d) => s + d.value, 0);
      const pipelineTotal = stages.reduce((s, x) => s + x.valueMinor, 0);

      return {
        generatedAt: new Date().toISOString(),
        scope,
        currency: ws.currency,
        timezone: ws.timezone,
        newLeadsToday: {
          value: nl[nl.length - 1] ?? 0,
          previous: nl.length > 1 ? (nl[nl.length - 2] ?? 0) : null,
          spark: nl,
        },
        avgFirstResponse: {
          seconds: response.samplesToday > 0 ? Math.round(rs[rs.length - 1] ?? 0) : null,
          previousSeconds:
            rs.length > 1 && (rs[rs.length - 2] ?? 0) > 0 ? Math.round(rs[rs.length - 2]!) : null,
          samples: response.samplesToday,
          spark: rs.map((v) => Math.round(v)),
        },
        recoveryQueue: recovery,
        attention,
        payments: {
          days,
          total: maskMoneyFigure(actorIn, totalCollected),
          series: paid.collected.map((d, i) => ({
            date: d.date,
            collectedMinor: showValues ? d.value : null,
            payments: paid.count[i]?.value ?? 0,
          })),
        },
        leadsPerDay: perDay.slice(-days),
        team: { members: team },
        pipeline: {
          stages: stages.map((s) => ({
            stageId: s.stageId,
            name: s.name,
            count: s.count,
            value: maskMoneyFigure(actorIn, s.valueMinor),
          })),
          total: maskMoneyFigure(actorIn, pipelineTotal),
        },
        appointments: {
          total: appts.total,
          items: appts.items.map((a) => ({ ...a, startsAt: a.startsAt.toISOString() })),
        },
        escalations24h: esc,
        revenueAtRisk: atRisk === null ? null : maskMoneyFigure(actorIn, atRisk),
        revenueRescued: rescued === null ? null : maskMoneyFigure(actorIn, rescued),
      };
    },
    opts,
  );
}

/** Lead Radar data (F5.6): waiting leads in the actor's scope + the team with availability. */
export async function radar(actorIn: Actor, opts: TxOptions = {}): Promise<RadarResponse> {
  const actor = effectiveActor(actorIn);
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const now = await repo.dbNow(tx);
      const team = await repo.teamAvailability(tx, actor.workspaceId);
      const leads = await repo.radarLeads(tx, actor);
      const custodians = new Set(leads.filter((l) => l.custody === 'fallback').map((l) => l.ownerUserId));
      return {
        now: now.toISOString(),
        members: team.map((m) => ({
          userId: m.userId,
          name: m.name,
          availability: m.availability,
          isCustodian: custodians.has(m.userId),
        })),
        leads: leads.map((l) => ({ ...l, ackWindowEndsAt: l.ackWindowEndsAt?.toISOString() ?? null })),
      };
    },
    opts,
  );
}
