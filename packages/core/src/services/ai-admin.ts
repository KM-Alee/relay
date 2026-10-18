// AI admin service (T-208; F6.1, F6.5): per-workspace AI settings, knowledge base, message templates.
// All mutations need `ai.manage`, run in one workspace tx, are audited (ai.settings_changed,
// knowledge.changed, template.changed). The AI itself never calls these writers (AGENTS rule 7).
import type { AiSettingsDto, AiSettingsInput, KbEntryDto, TemplateAdminDto } from '@relay/contracts/api/ai';
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { KbEntry } from '../ai/tasks/standin';
import { dayStart } from '../ai/usage';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { config } from '../config';
import { AppError, notFound } from '../errors';
import { emit } from '../realtime';
import { isUniqueViolation, iso, rows, one } from './crm-shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const MICROS = 1_000_000;

// ── settings ────────────────────────────────────────────────────────────
export interface AiSettingsRow {
  standinMode: AiSettingsInput['standinMode'];
  triggerUnackedSeconds: number;
  dailyCostCapMicros: number;
  triageEnabled: boolean;
  transcribeEnabled: boolean;
  aiEnabled: boolean;
}

const DEFAULT_SETTINGS = (): AiSettingsRow => ({
  standinMode: 'off',
  triggerUnackedSeconds: 60,
  dailyCostCapMicros: Math.round(config.ai.AI_DEFAULT_DAILY_COST_CAP_USD * MICROS),
  triageEnabled: true,
  transcribeEnabled: true,
  aiEnabled: true,
});

function mapSettings(r: Loose | null): AiSettingsRow {
  if (!r) return DEFAULT_SETTINGS();
  return {
    standinMode: r.standin_mode,
    triggerUnackedSeconds: r.trigger_unacked_seconds,
    dailyCostCapMicros: Number(r.daily_cost_cap_micros),
    triageEnabled: r.triage_enabled,
    transcribeEnabled: r.transcribe_enabled,
    aiEnabled: r.ai_enabled,
  };
}

/** Internal read for AI callers (stand-in trigger, voice, triage). No actor: callers are system jobs. */
export async function getAiSettings(workspaceId: string): Promise<AiSettingsRow> {
  return withWorkspaceTx(workspaceId, async (tx) =>
    mapSettings(
      await one<Loose>(tx, sql`select * from ai_settings where workspace_id = ${workspaceId}::uuid`),
    ),
  );
}

/** `AiDeps` for a workspace: per-workspace flag + daily cap (the global AI_ENABLED still wins in runAiTask). */
export async function aiDepsFor(workspaceId: string) {
  const s = await getAiSettings(workspaceId);
  return { enabled: config.ai.AI_ENABLED && s.aiEnabled, capMicros: s.dailyCostCapMicros };
}

async function toSettingsDto(tx: Parameters<Parameters<typeof withWorkspaceTx>[1]>[0], ws: string) {
  const s = mapSettings(
    await one<Loose>(tx, sql`select * from ai_settings where workspace_id = ${ws}::uuid`),
  );
  const spent = await one<{ s: string }>(
    tx,
    sql`select coalesce(sum(cost_micros), 0)::text s from ai_usage where workspace_id = ${ws}::uuid and created_at >= ${dayStart().toISOString()}::timestamptz`,
  );
  const dto: AiSettingsDto = {
    standinMode: s.standinMode,
    triggerUnackedSeconds: s.triggerUnackedSeconds,
    dailyCostCapUsd: s.dailyCostCapMicros / MICROS,
    triageEnabled: s.triageEnabled,
    transcribeEnabled: s.transcribeEnabled,
    aiEnabled: s.aiEnabled,
    globalEnabled: config.ai.AI_ENABLED,
    spentTodayUsd: Math.round((Number(spent?.s ?? 0) / MICROS) * 10_000) / 10_000,
  };
  return dto;
}

async function getSettings(actor: Actor): Promise<AiSettingsDto> {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, (tx) => toSettingsDto(tx, actor.workspaceId));
}

async function putSettings(actor: Actor, input: AiSettingsInput): Promise<AiSettingsDto> {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const before = await toSettingsDto(tx, actor.workspaceId);
    await tx.execute(sql`insert into ai_settings
      (workspace_id, standin_mode, trigger_unacked_seconds, daily_cost_cap_micros, triage_enabled, transcribe_enabled, ai_enabled)
      values (${actor.workspaceId}::uuid, ${input.standinMode}, ${input.triggerUnackedSeconds},
              ${Math.round(input.dailyCostCapUsd * MICROS)}, ${input.triageEnabled}, ${input.transcribeEnabled}, ${input.aiEnabled})
      on conflict (workspace_id) do update set
        standin_mode = excluded.standin_mode, trigger_unacked_seconds = excluded.trigger_unacked_seconds,
        daily_cost_cap_micros = excluded.daily_cost_cap_micros, triage_enabled = excluded.triage_enabled,
        transcribe_enabled = excluded.transcribe_enabled, ai_enabled = excluded.ai_enabled`);
    const after = await toSettingsDto(tx, actor.workspaceId);
    await auditAppend(tx, actor, {
      action: 'ai.settings_changed',
      targetType: 'ai_settings',
      targetId: actor.workspaceId,
      before: {
        standinMode: before.standinMode,
        triggerUnackedSeconds: before.triggerUnackedSeconds,
        dailyCostCapUsd: before.dailyCostCapUsd,
        triageEnabled: before.triageEnabled,
        transcribeEnabled: before.transcribeEnabled,
        aiEnabled: before.aiEnabled,
      },
      after: { ...input },
    });
    return after;
  });
}

// ── knowledge base ──────────────────────────────────────────────────────
const toKb = (r: Loose): KbEntryDto => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  language: r.language,
  enabled: r.enabled,
  updatedAt: iso(r.updated_at)!,
});

const kbList = async (actor: Actor) => {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => ({
    items: (await rows<Loose>(tx, sql`select * from ai_knowledge order by created_at, title`)).map(toKb),
  }));
};

async function kbCreate(
  actor: Actor,
  i: { kind: string; title: string; body: string; language: string; enabled: boolean },
) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const r = (await one<Loose>(
      tx,
      sql`insert into ai_knowledge (workspace_id, kind, title, body, language, enabled)
          values (${actor.workspaceId}::uuid, ${i.kind}, ${i.title}, ${i.body}, ${i.language}, ${i.enabled}) returning *`,
    ))!;
    await auditAppend(tx, actor, {
      action: 'knowledge.changed',
      targetType: 'ai_knowledge',
      targetId: r.id,
      after: { op: 'create', kind: i.kind, title: i.title, language: i.language, enabled: i.enabled },
    });
    return toKb(r);
  });
}

async function kbUpdate(
  actor: Actor,
  id: string,
  p: Partial<{ kind: string; title: string; body: string; language: string; enabled: boolean }>,
) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const cur = await one<Loose>(tx, sql`select * from ai_knowledge where id = ${id}::uuid for update`);
    if (!cur) throw notFound();
    const r = (await one<Loose>(
      tx,
      sql`update ai_knowledge set kind = ${p.kind ?? cur.kind}, title = ${p.title ?? cur.title},
          body = ${p.body ?? cur.body}, language = ${p.language ?? cur.language}, enabled = ${p.enabled ?? cur.enabled}
          where id = ${id}::uuid returning *`,
    ))!;
    await auditAppend(tx, actor, {
      action: 'knowledge.changed',
      targetType: 'ai_knowledge',
      targetId: id,
      before: { title: cur.title, enabled: cur.enabled },
      after: { op: 'update', title: r.title, enabled: r.enabled, fields: Object.keys(p) },
    });
    return toKb(r);
  });
}

async function kbDelete(actor: Actor, id: string) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const cur = await one<Loose>(tx, sql`delete from ai_knowledge where id = ${id}::uuid returning title`);
    if (!cur) throw notFound();
    await auditAppend(tx, actor, {
      action: 'knowledge.changed',
      targetType: 'ai_knowledge',
      targetId: id,
      before: { title: cur.title },
      after: { op: 'delete' },
    });
    return { ok: true as const };
  });
}

/**
 * KB for the stand-in (F6.5): ENABLED entries only. generateStandInReply ranks them by keyword overlap with
 * the customer message and caps them to ~4 KB, so callers pass the whole list.
 */
export async function loadKnowledge(workspaceId: string): Promise<KbEntry[]> {
  const all = await withWorkspaceTx(workspaceId, (tx) =>
    rows<Loose>(tx, sql`select id, kind, title, body from ai_knowledge where enabled order by created_at`),
  );
  return all.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body }));
}

// ── message templates (I1.10) ───────────────────────────────────────────
const toTpl = (r: Loose): TemplateAdminDto => ({
  id: r.id,
  key: r.key,
  locale: r.locale,
  body: r.body,
  waTemplateName: r.wa_template_name,
  waTemplateLang: r.wa_template_lang,
  updatedAt: iso(r.updated_at)!,
});

const conflict = () => new AppError('CONFLICT', { details: { field: 'key' } });

async function templatesList(actor: Actor) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => ({
    items: (await rows<Loose>(tx, sql`select * from message_templates order by key, locale`)).map(toTpl),
  }));
}

async function templatesCreate(
  actor: Actor,
  i: {
    key: string;
    locale: string;
    body: string;
    waTemplateName: string | null;
    waTemplateLang: string | null;
  },
) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    try {
      const r = (await one<Loose>(
        tx,
        sql`insert into message_templates (workspace_id, key, locale, body, wa_template_name, wa_template_lang)
            values (${actor.workspaceId}::uuid, ${i.key}, ${i.locale}, ${i.body}, ${i.waTemplateName}, ${i.waTemplateLang}) returning *`,
      ))!;
      await auditAppend(tx, actor, {
        action: 'template.changed',
        targetType: 'message_template',
        targetId: r.id,
        after: { op: 'create', key: i.key, locale: i.locale },
      });
      return toTpl(r);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict();
      throw e;
    }
  });
}

async function templatesUpdate(
  actor: Actor,
  id: string,
  p: Partial<{
    key: string;
    locale: string;
    body: string;
    waTemplateName: string | null;
    waTemplateLang: string | null;
  }>,
) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const cur = await one<Loose>(tx, sql`select * from message_templates where id = ${id}::uuid for update`);
    if (!cur) throw notFound();
    try {
      const r = (await one<Loose>(
        tx,
        sql`update message_templates set key = ${p.key ?? cur.key}, locale = ${p.locale ?? cur.locale},
            body = ${p.body ?? cur.body},
            wa_template_name = ${p.waTemplateName !== undefined ? p.waTemplateName : cur.wa_template_name},
            wa_template_lang = ${p.waTemplateLang !== undefined ? p.waTemplateLang : cur.wa_template_lang}
            where id = ${id}::uuid returning *`,
      ))!;
      await auditAppend(tx, actor, {
        action: 'template.changed',
        targetType: 'message_template',
        targetId: id,
        before: { key: cur.key, locale: cur.locale },
        after: { op: 'update', key: r.key, locale: r.locale, fields: Object.keys(p) },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'conversations' });
      return toTpl(r);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict();
      throw e;
    }
  });
}

async function templatesDelete(actor: Actor, id: string) {
  assertPermission(actor, 'ai.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const cur = await one<Loose>(
      tx,
      sql`delete from message_templates where id = ${id}::uuid returning key, locale`,
    );
    if (!cur) throw notFound();
    await auditAppend(tx, actor, {
      action: 'template.changed',
      targetType: 'message_template',
      targetId: id,
      before: { key: cur.key, locale: cur.locale },
      after: { op: 'delete' },
    });
    return { ok: true as const };
  });
}

export const aiAdminService = {
  getSettings,
  putSettings,
  kbList,
  kbCreate,
  kbUpdate,
  kbDelete,
  templatesList,
  templatesCreate,
  templatesUpdate,
  templatesDelete,
};
