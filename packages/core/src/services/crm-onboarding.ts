// Describe-your-business onboarding (T-218, F9.3). The Owner/Admin describes the business in a sentence (or
// picks a built-in template); AI (or the template fallback) PROPOSES pipelines, stages, custom fields,
// stage-required fields and tags. NOTHING is applied until the reviewed proposal is confirmed, and apply
// is ONE transaction (all or nothing), audited. With AI off the built-in templates still work.
import {
  onboardingProposal,
  type OnboardingProposal,
  type OnboardingApplyResponse,
} from '@relay/contracts/api/crm-extras';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiEnabled, runAiTask, type AiDeps } from '../ai/index';
import { block } from '../ai/tasks/context';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import { ONBOARDING_TEMPLATES, matchTemplate } from './crm-onboarding-templates';
import { one, rows, validationFailed } from './crm-shared';

// Loose shape for the model (strict-mode friendly, no constraints); `normalize` enforces the real contract.
const aiProposalSchema = z.object({
  businessSummary: z.string(),
  pipelines: z.array(
    z.object({
      name: z.string(),
      stages: z.array(
        z.object({
          name: z.string(),
          kind: z.enum(['open', 'won', 'lost']),
          rotDays: z.number().nullable(),
          requiredFieldKeys: z.array(z.string()),
        }),
      ),
    }),
  ),
  fields: z.array(
    z.object({
      entity: z.enum(['contact', 'opportunity']),
      key: z.string(),
      label: z.object({ en: z.string(), ur: z.string() }),
      type: z.enum(['text', 'number', 'date', 'dropdown', 'checkbox']),
      options: z.array(z.object({ value: z.string(), label: z.object({ en: z.string(), ur: z.string() }) })),
    }),
  ),
  tags: z.array(z.string()),
});

const slug = (s: string, max = 40) => {
  const k = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return /^[a-z]/.test(k) ? k : k ? `f_${k}`.slice(0, max) : '';
};
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** Coerce a model proposal into the strict contract (never trust AI output, Q3). Null when unusable. */
export function normalizeProposal(raw: z.infer<typeof aiProposalSchema>): OnboardingProposal | null {
  const used = new Set<string>();
  const fields: OnboardingProposal['fields'] = [];
  for (const f of raw.fields.slice(0, 12)) {
    const key = slug(f.key, 40);
    const en = clip(f.label.en, 80);
    if (!key || !en || used.has(`${f.entity}:${key}`)) continue;
    used.add(`${f.entity}:${key}`);
    const options = f.options
      .slice(0, 20)
      .map((o) => ({
        value: slug(o.value, 60),
        label: { en: clip(o.label.en, 80), ur: clip(o.label.ur, 80) },
      }))
      .filter((o) => o.value && o.label.en)
      .map((o) => ({ ...o, label: { en: o.label.en, ur: o.label.ur || o.label.en } }));
    const dropdown = f.type === 'dropdown' && options.length >= 2;
    fields.push({
      entity: f.entity,
      key,
      label: { en, ur: clip(f.label.ur, 80) || en },
      type: f.type === 'dropdown' && !dropdown ? 'text' : f.type,
      options: dropdown ? options : [],
    });
  }
  const keys = new Set(fields.map((f) => f.key));
  const pipelines: OnboardingProposal['pipelines'] = [];
  for (const p of raw.pipelines.slice(0, 2)) {
    const name = clip(p.name, 60);
    if (!name) continue;
    let stages = p.stages
      .map((s) => ({ ...s, name: clip(s.name, 60) }))
      .filter((s) => s.name)
      .slice(0, 12);
    if (!stages.some((s) => s.kind === 'won'))
      stages = [...stages.slice(0, 10), { name: 'Won', kind: 'won', rotDays: null, requiredFieldKeys: [] }];
    if (!stages.some((s) => s.kind === 'lost'))
      stages = [...stages.slice(0, 11), { name: 'Lost', kind: 'lost', rotDays: null, requiredFieldKeys: [] }];
    if (stages.length < 2) continue;
    pipelines.push({
      name,
      stages: stages.map((s, i) => ({
        name: s.name,
        kind: s.kind,
        rotDays: s.kind === 'open' && s.rotDays ? Math.min(365, Math.max(1, Math.round(s.rotDays))) : null,
        requiredFieldKeys:
          s.kind === 'open' && i > 0
            ? [...new Set(s.requiredFieldKeys.map((k) => slug(k)).filter((k) => keys.has(k)))].slice(0, 10)
            : [],
      })),
    });
  }
  const tagSeen = new Set<string>();
  const tags = raw.tags
    .map((t) => clip(t, 40))
    .filter((t) => t && !tagSeen.has(t.toLowerCase()) && tagSeen.add(t.toLowerCase()))
    .slice(0, 12);
  const out = onboardingProposal.safeParse({
    businessSummary: clip(raw.businessSummary, 300),
    pipelines,
    fields,
    tags,
  });
  return out.success ? out.data : null;
}

export const onboardingService = {
  /** GET /onboarding/templates (crm.config.manage). */
  async templates(actor: Actor, opts: { deps?: AiDeps } = {}) {
    assertPermission(actor, 'crm.config.manage');
    return { aiEnabled: aiEnabled(opts.deps), items: [...ONBOARDING_TEMPLATES] };
  },

  /**
   * POST /onboarding/propose: a template, or an AI proposal for a description. Reads nothing from the DB and
   * writes nothing: the review screen applies it later. AI off / failed -> keyword-matched template, else
   * `unavailable` so the UI can offer the templates.
   */
  async propose(
    actor: Actor,
    input: { description?: string; templateId?: 'real_estate' | 'solar' | 'clinic' },
    opts: { deps?: AiDeps } = {},
  ) {
    assertPermission(actor, 'crm.config.manage');
    if (input.templateId) {
      const t = ONBOARDING_TEMPLATES.find((x) => x.id === input.templateId);
      return {
        source: 'template' as const,
        templateId: t?.id ?? null,
        proposal: t?.proposal ?? null,
        aiError: null,
      };
    }
    const description = input.description ?? '';
    let aiError: string | null;
    if (aiEnabled(opts.deps)) {
      const res = await runAiTask({
        workspaceId: actor.workspaceId,
        task: 'onboarding_proposal',
        modelSlot: 'chat',
        userContent: block('description', description),
        schema: aiProposalSchema,
        timeoutMs: 40_000,
        maxOutputTokens: 2500,
        retry: false,
        deps: opts.deps,
      });
      if (res.ok) {
        const proposal = normalizeProposal(res.value);
        if (proposal) return { source: 'ai' as const, templateId: null, proposal, aiError: null };
        aiError = 'invalid_output';
      } else aiError = res.error;
    } else aiError = 'disabled';
    const id = matchTemplate(description);
    const t = ONBOARDING_TEMPLATES.find((x) => x.id === id);
    return t
      ? { source: 'template' as const, templateId: t.id, proposal: t.proposal, aiError }
      : { source: 'unavailable' as const, templateId: null, proposal: null, aiError };
  },

  /** POST /onboarding/apply: create everything in ONE transaction. Existing names/keys are left untouched. */
  async apply(
    actor: Actor,
    input: { proposal: OnboardingProposal; makeDefault: boolean },
    opts: TxOptions = {},
  ): Promise<OnboardingApplyResponse> {
    assertPermission(actor, 'crm.config.manage');
    const p = input.proposal;
    const seenKeys = new Set<string>();
    for (const f of p.fields) {
      const k = `${f.entity}:${f.key}`;
      if (seenKeys.has(k)) throw validationFailed('proposal.fields', 'duplicate_key');
      seenKeys.add(k);
      if ((f.type === 'dropdown') !== f.options.length > 0)
        throw validationFailed(
          `proposal.fields.${f.key}`,
          f.type === 'dropdown' ? 'options_required' : 'options_not_allowed',
        );
    }
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const created = { pipelines: 0, stages: 0, fields: 0, tags: 0 };
        const skipped = { pipelines: 0, fields: 0, tags: 0 };
        const ws = actor.workspaceId;

        // Fields first (stages may require them). Existing keys keep their definition.
        const existing = await rows<{ id: string; entity: string; key: string; pipeline_id: string | null }>(
          tx,
          sql`select id, entity, key, pipeline_id from custom_fields`,
        );
        const idByKey = new Map<string, string>(); // key -> field id (shared fields only)
        for (const e of existing) if (!e.pipeline_id) idByKey.set(e.key, e.id);
        const pos = await one<{ n: number }>(
          tx,
          sql`select coalesce(max(position) + 1, 0)::int as n from custom_fields`,
        );
        let position = pos?.n ?? 0;
        for (const f of p.fields) {
          const hit = existing.find((e) => e.entity === f.entity && e.key === f.key);
          if (hit) {
            skipped.fields++;
            if (!hit.pipeline_id) idByKey.set(f.key, hit.id);
            continue;
          }
          const id = uuidv7();
          await tx.execute(
            sql`insert into custom_fields (id, workspace_id, entity, pipeline_id, key, label, type, options, position)
                values (${id}::uuid, ${ws}::uuid, ${f.entity}, null, ${f.key}, ${JSON.stringify(f.label)}::jsonb,
                        ${f.type}, ${JSON.stringify(f.options)}::jsonb, ${position++})`,
          );
          idByKey.set(f.key, id);
          created.fields++;
          await auditAppend(tx, actor, {
            action: 'field.created',
            targetType: 'custom_field',
            targetId: id,
            after: { entity: f.entity, key: f.key, type: f.type, via: 'onboarding' },
          });
        }

        // Pipelines + stages (+ rot, required fields).
        const pipelineIds: string[] = [];
        const names = new Set(
          (await rows<{ name: string }>(tx, sql`select name from pipelines`)).map((r) =>
            r.name.toLowerCase(),
          ),
        );
        const hadAny = names.size > 0;
        for (const pl of p.pipelines) {
          if (names.has(pl.name.toLowerCase())) {
            skipped.pipelines++;
            continue;
          }
          names.add(pl.name.toLowerCase());
          const pid = uuidv7();
          const at = await one<{ n: number }>(
            tx,
            sql`select coalesce(max(position) + 1, 0)::int as n from pipelines`,
          );
          await tx.execute(
            sql`insert into pipelines (id, workspace_id, name, position, is_default)
                values (${pid}::uuid, ${ws}::uuid, ${pl.name}, ${at?.n ?? 0}, false)`,
          );
          for (const [i, s] of pl.stages.entries()) {
            const sid = uuidv7();
            await tx.execute(
              sql`insert into stages (id, workspace_id, pipeline_id, name, position, kind, rot_seconds)
                  values (${sid}::uuid, ${ws}::uuid, ${pid}::uuid, ${s.name}, ${i}, ${s.kind},
                          ${s.kind === 'open' && s.rotDays ? s.rotDays * 86400 : null})`,
            );
            for (const key of new Set(s.requiredFieldKeys)) {
              const fid = idByKey.get(key);
              if (fid)
                await tx.execute(
                  sql`insert into stage_required_fields (workspace_id, stage_id, field_id)
                      values (${ws}::uuid, ${sid}::uuid, ${fid}::uuid) on conflict do nothing`,
                );
            }
            created.stages++;
          }
          pipelineIds.push(pid);
          created.pipelines++;
          await auditAppend(tx, actor, {
            action: 'pipeline.created',
            targetType: 'pipeline',
            targetId: pid,
            after: { name: pl.name, stages: pl.stages.length, via: 'onboarding' },
          });
        }
        if (pipelineIds.length && (input.makeDefault || !hadAny)) {
          await tx.execute(sql`update pipelines set is_default = false where is_default`);
          await tx.execute(sql`update pipelines set is_default = true where id = ${pipelineIds[0]!}::uuid`);
        }

        // Tags.
        for (const name of p.tags) {
          const hit = await one(tx, sql`select 1 as x from tags where lower(name) = lower(${name})`);
          if (hit) {
            skipped.tags++;
            continue;
          }
          const id = uuidv7();
          await tx.execute(
            sql`insert into tags (id, workspace_id, name) values (${id}::uuid, ${ws}::uuid, ${name})`,
          );
          created.tags++;
          await auditAppend(tx, actor, {
            action: 'tag.created',
            targetType: 'tag',
            targetId: id,
            after: { name, via: 'onboarding' },
          });
        }

        await auditAppend(tx, actor, {
          action: 'workspace.settings_changed',
          targetType: 'workspace',
          targetId: ws,
          after: { via: 'onboarding', created, skipped, summary: p.businessSummary.slice(0, 200) },
        });
        await emit(tx, { workspaceId: ws, topic: 'opportunities' });
        await emit(tx, { workspaceId: ws, topic: 'contacts' });
        return { created, skipped, pipelineIds };
      },
      opts,
    );
  },
};
