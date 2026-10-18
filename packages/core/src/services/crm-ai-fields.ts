// AI custom fields (T-219, F9.1). A field of type `ai` carries a prompt + output type; it fills itself from the
// contact's conversation and notes through `runAiTask` (the only door to the model). Rules enforced here:
//  - human wins: a value a person set/edited (`source = human`) is never overwritten unless `force` (explicit
//    "unlock and refresh"); a person saving even the same text takes ownership;
//  - the model call happens OUTSIDE any DB transaction (AGENTS rule 3): read tx -> AI call -> write tx;
//  - opportunity values never reach the prompt (I6.6); AI output is untrusted data stored as plain text;
//  - an AI fill is not a human action: it writes the timeline as the AI actor and never acknowledges a lead;
//  - works with AI off: states are readable/editable, fill reports `ai_disabled`.
import type { AiConfig } from '@relay/contracts/api/crm';
import type { AiFieldState } from '@relay/contracts/api/crm-extras';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiEnabled, runAiTask, type AiDeps } from '../ai/index';
import { block, conversationBlock, type Turn } from '../ai/tasks/context';
import { aiActor, append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { notFound } from '../errors';
import { emit } from '../realtime/index';
import { recordActivity } from './crm-activity';
import { ENTITY, iso, one, rows, saveFieldValues, scopeSql, type FieldRow } from './crm-shared';

const fillSchema = z.object({ value: z.string().nullable(), confidence: z.number() });
export const MIN_CONFIDENCE = 0.35;

type Target = { kind: 'contact'; contactId: string } | { kind: 'opportunity'; opportunityId: string };
type Status = 'filled' | 'unchanged' | 'unknown' | 'locked' | 'ai_disabled' | 'failed';
type FieldValue = string | number | boolean;

interface AiFieldRow extends FieldRow {
  ai_config: AiConfig | null;
}

interface Resolved {
  contactId: string;
  opportunityId: string | null;
  record: { entity: 'contact' | 'opportunity'; id: string; pipelineId: string | null };
}

async function resolveTarget(tx: Tx, actor: Actor, t: Target): Promise<Resolved> {
  if (t.kind === 'contact') {
    assertPermission(actor, 'crm.contact.view');
    const c = await one(
      tx,
      sql`select c.id from contacts c where c.workspace_id = ${actor.workspaceId}::uuid and c.id = ${t.contactId}::uuid
          and c.deleted_at is null and ${scopeSql(actor, 'contact')}`,
    );
    if (!c) throw notFound();
    return {
      contactId: t.contactId,
      opportunityId: null,
      record: { entity: 'contact', id: t.contactId, pipelineId: null },
    };
  }
  assertPermission(actor, 'crm.opportunity.view');
  const o = await one<{ id: string; contact_id: string; pipeline_id: string }>(
    tx,
    sql`select o.id, o.contact_id, o.pipeline_id from opportunities o
        where o.workspace_id = ${actor.workspaceId}::uuid and o.id = ${t.opportunityId}::uuid
          and o.deleted_at is null and ${scopeSql(actor, 'opportunity')}`,
  );
  if (!o) throw notFound();
  return {
    contactId: o.contact_id,
    opportunityId: o.id,
    record: { entity: 'opportunity', id: o.id, pipelineId: o.pipeline_id },
  };
}

async function loadAiFields(tx: Tx, r: Resolved, onlyId?: string): Promise<AiFieldRow[]> {
  return rows<AiFieldRow>(
    tx,
    sql`select * from custom_fields where type = 'ai' and entity = ${r.record.entity}
        ${r.record.pipelineId ? sql`and (pipeline_id is null or pipeline_id = ${r.record.pipelineId}::uuid)` : sql``}
        ${onlyId ? sql`and id = ${onlyId}::uuid` : sql``} order by position, key`,
  );
}

async function states(tx: Tx, r: Resolved, fields: AiFieldRow[]): Promise<AiFieldState[]> {
  if (!fields.length) return [];
  const col = ENTITY[r.record.entity].idCol;
  const vals = await rows<{
    field_id: string;
    value: FieldValue;
    source: 'ai' | 'human' | 'import';
    updated_at: Date;
  }>(
    tx,
    sql`select field_id, value, source, updated_at from field_values where ${sql.raw(col)} = ${r.record.id}::uuid`,
  );
  const byField = new Map(vals.map((v) => [v.field_id, v]));
  return fields.map((f) => {
    const v = byField.get(f.id);
    return {
      fieldId: f.id,
      entity: f.entity as 'contact' | 'opportunity',
      key: f.key,
      label: f.label,
      outputType: f.ai_config?.outputType ?? 'text',
      options: f.options,
      value: v?.value ?? null,
      source: v?.source ?? null,
      filledAt: v ? iso(v.updated_at) : null,
    };
  });
}

/** What the model may read: contact facts, notes and the conversation. Never an opportunity value. */
async function buildContext(tx: Tx, r: Resolved): Promise<{ text: string; hasData: boolean }> {
  const c = await one<{ name: string; language: string | null; company: string | null }>(
    tx,
    sql`select c.name, c.language, co.name as company from contacts c
        left join companies co on co.workspace_id = c.workspace_id and co.id = c.company_id where c.id = ${r.contactId}::uuid`,
  );
  const tags = await rows<{ name: string }>(
    tx,
    sql`select t.name from contact_tags j join tags t on t.workspace_id = j.workspace_id and t.id = j.tag_id
        where j.contact_id = ${r.contactId}::uuid order by lower(t.name) limit 20`,
  );
  const known = await rows<{ label: { en: string }; value: unknown }>(
    tx,
    sql`select f.label, v.value from field_values v join custom_fields f on f.workspace_id = v.workspace_id and f.id = v.field_id
        where v.contact_id = ${r.contactId}::uuid and f.type <> 'ai' limit 30`,
  );
  const opp = r.opportunityId
    ? await one<{ title: string; stage: string }>(
        tx,
        sql`select o.title, s.name as stage from opportunities o join stages s on s.workspace_id = o.workspace_id and s.id = o.stage_id
            where o.id = ${r.opportunityId}::uuid`,
      )
    : null;
  const notes = await rows<{ type: string; payload: { body?: string; text?: string } }>(
    tx,
    sql`select type, payload from activities where contact_id = ${r.contactId}::uuid and type in ('note', 'call')
        order by occurred_at desc limit 10`,
  );
  const msgs = await rows<{ author_type: 'customer' | 'user' | 'ai' | 'system'; text: string | null }>(
    tx,
    sql`select m.author_type, coalesce(nullif(m.body, ''), m.transcript) as text
        from messages m join conversations cv on cv.workspace_id = m.workspace_id and cv.id = m.conversation_id
        where cv.contact_id = ${r.contactId}::uuid and m.kind <> 'event' and m.author_type <> 'system'
          and coalesce(nullif(m.body, ''), m.transcript) is not null
        order by m.created_at desc limit 30`,
  );
  const turns: Turn[] = msgs
    .reverse()
    .map((m) => ({
      role: m.author_type === 'customer' ? 'customer' : m.author_type === 'ai' ? 'ai' : 'human',
      text: m.text ?? '',
    }));
  const noteLines = notes
    .map(
      (n) =>
        `[${n.type}] ${String(n.payload?.body ?? n.payload?.text ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 500)}`,
    )
    .filter((l) => l.length > 8);
  const facts = [
    `name: ${c?.name ?? ''}`,
    c?.company ? `company: ${c.company}` : '',
    c?.language ? `language: ${c.language}` : '',
    tags.length ? `tags: ${tags.map((t) => t.name).join(', ')}` : '',
    ...known.map((k) => `${k.label?.en ?? 'field'}: ${String(k.value)}`),
    opp ? `deal: ${opp.title} (stage ${opp.stage})` : '',
  ].filter(Boolean);
  const text = [
    block('contact', facts.join('\n')),
    block('notes', noteLines.join('\n') || '(none)'),
    conversationBlock(turns, 30),
  ].join('\n');
  return { text, hasData: turns.length > 0 || noteLines.length > 0 };
}

function interpret(f: AiFieldRow, raw: string | null, confidence: number): FieldValue | null {
  if (raw === null || confidence < MIN_CONFIDENCE) return null;
  const v = raw.trim();
  if (!v) return null;
  const out = f.ai_config?.outputType ?? 'text';
  if (out === 'number') {
    const n = Number(v.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (out === 'dropdown') return f.options.find((o) => o.value === v)?.value ?? null;
  return v.slice(0, 200);
}

export const aiFieldsService = {
  /** GET /ai-fields: the AI fields of a contact / opportunity with value, source and timestamp. */
  async list(
    actor: Actor,
    target: Target,
    opts: TxOptions & { deps?: AiDeps } = {},
  ): Promise<{ aiEnabled: boolean; items: AiFieldState[] }> {
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await resolveTarget(tx, actor, target);
        return { aiEnabled: aiEnabled(opts.deps), items: await states(tx, r, await loadAiFields(tx, r)) };
      },
      opts,
    );
  },

  /** POST /ai-fields/fill: fill one or all AI fields of the record. Human-set values are skipped (locked). */
  async fill(
    actor: Actor,
    target: Target,
    input: { fieldId?: string; force?: boolean },
    opts: TxOptions & { deps?: AiDeps } = {},
  ): Promise<{
    aiEnabled: boolean;
    results: { fieldId: string; status: Status }[];
    items: AiFieldState[];
  }> {
    assertPermission(actor, target.kind === 'contact' ? 'crm.contact.edit' : 'crm.opportunity.edit');
    const enabled = aiEnabled(opts.deps);

    // 1) read (no external call inside a transaction)
    const prep = await withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const r = await resolveTarget(tx, actor, target);
        const fields = await loadAiFields(tx, r, input.fieldId);
        if (input.fieldId && !fields.length) throw notFound();
        const before = await states(tx, r, fields);
        const ctx = enabled ? await buildContext(tx, r) : { text: '', hasData: false };
        return { r, fields, before, ctx };
      },
      opts,
    );
    const { r, fields, before, ctx } = prep;
    const statusOf = new Map<string, Status>();

    if (!enabled) {
      for (const f of fields) statusOf.set(f.id, 'ai_disabled');
    }

    // 2) ask the model for every unlocked field
    const answers = new Map<string, FieldValue | null>();
    if (enabled) {
      await Promise.all(
        fields.map(async (f) => {
          const cur = before.find((b) => b.fieldId === f.id);
          if (cur?.source === 'human' && !input.force) return void statusOf.set(f.id, 'locked');
          if (!ctx.hasData) return void statusOf.set(f.id, 'unknown');
          const cfg = f.ai_config;
          if (!cfg) return void statusOf.set(f.id, 'failed');
          const res = await runAiTask({
            workspaceId: actor.workspaceId,
            task: 'field_fill',
            modelSlot: 'chat',
            userContent: [
              block('instruction', cfg.prompt),
              block(
                'field',
                [
                  `key: ${f.key}`,
                  `label: ${f.label.en}`,
                  `output type: ${cfg.outputType}`,
                  cfg.outputType === 'dropdown'
                    ? `options: ${f.options.map((o) => `${o.value} (${o.label.en})`).join('; ')}`
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
              ),
              ctx.text,
            ].join('\n'),
            schema: fillSchema,
            timeoutMs: 15_000,
            maxOutputTokens: 200,
            retry: true,
            deps: opts.deps,
          });
          if (!res.ok) return void statusOf.set(f.id, 'failed');
          const value = interpret(f, res.value.value, res.value.confidence);
          if (value === null) return void statusOf.set(f.id, 'unknown');
          answers.set(f.id, value);
        }),
      );
    }

    // 3) write (re-check the human lock: a person may have typed while the model was thinking)
    const items = await withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const col = ENTITY[r.record.entity].idCol;
        for (const [fieldId, value] of answers) {
          const cur = await one<{ source: string; value: unknown }>(
            tx,
            sql`select source, value from field_values where field_id = ${fieldId}::uuid and ${sql.raw(col)} = ${r.record.id}::uuid for update`,
          );
          if (cur?.source === 'human' && !input.force) {
            statusOf.set(fieldId, 'locked');
            continue;
          }
          const changes = await saveFieldValues(
            tx,
            actor,
            r.record.entity,
            r.record.id,
            { [fieldId]: value },
            { source: 'ai', pipelineId: r.record.pipelineId ?? undefined },
          );
          // `saveFieldValues` skips identical values; a same-value AI answer over a human one still re-labels it.
          if (cur?.source === 'human' && !changes.length)
            await tx.execute(
              sql`update field_values set source = 'ai', updated_by = null, updated_at = now()
                  where field_id = ${fieldId}::uuid and ${sql.raw(col)} = ${r.record.id}::uuid`,
            );
          if (!changes.length && cur?.source !== 'human') {
            statusOf.set(fieldId, 'unchanged');
            continue;
          }
          statusOf.set(fieldId, 'filled');
          await recordActivity(tx, aiActor(actor.workspaceId), {
            contactId: r.contactId,
            opportunityId: r.opportunityId,
            type: 'field_edit',
            actorType: 'ai',
            payload: {
              source: 'ai',
              changes: changes.map((c) => ({ key: c.key, from: c.from, to: c.to })),
            },
          });
          await auditAppend(tx, actor, {
            action: 'field.ai_filled',
            targetType: 'custom_field',
            targetId: fieldId,
            meta: { recordType: r.record.entity, recordId: r.record.id, forced: Boolean(input.force) },
          });
        }
        if (answers.size)
          await emit(tx, {
            workspaceId: actor.workspaceId,
            topic: ENTITY[r.record.entity].realtime,
            ids: [r.record.id],
          });
        return states(tx, r, await loadAiFields(tx, r, input.fieldId));
      },
      opts,
    );
    return {
      aiEnabled: enabled,
      results: fields.map((f) => ({ fieldId: f.id, status: statusOf.get(f.id) ?? 'unknown' })),
      items,
    };
  },
};
