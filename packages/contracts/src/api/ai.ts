// ai API contracts: AI settings, knowledge base, message templates, voice-note retry (docs/11-api.md).
// Owner: Lane C (T-208 F6.5/F6.1, T-217 F8.3). Admin endpoints need `ai.manage`.
import { z } from 'zod';
import { endpoint } from './endpoint';

export const KB_KINDS = ['pricing', 'service', 'faq', 'hours', 'area'] as const;
export const AI_LANGS = ['en', 'ur', 'ur-Latn'] as const;
export const STANDIN_MODES = ['off', 'unacked', 'no_handler', 'after_hours'] as const;

export const kbEntryDto = z.object({
  id: z.uuid(),
  kind: z.enum(KB_KINDS),
  title: z.string(),
  body: z.string(),
  language: z.enum(AI_LANGS),
  enabled: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type KbEntryDto = z.infer<typeof kbEntryDto>;

export const kbInput = z.object({
  kind: z.enum(KB_KINDS).default('faq'),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  language: z.enum(AI_LANGS).default('en'),
  enabled: z.boolean().default(true),
});
export const kbPatch = z.object({
  kind: z.enum(KB_KINDS).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  language: z.enum(AI_LANGS).optional(),
  enabled: z.boolean().optional(),
});

export const aiSettingsDto = z.object({
  standinMode: z.enum(STANDIN_MODES),
  triggerUnackedSeconds: z.number().int(),
  dailyCostCapUsd: z.number(),
  triageEnabled: z.boolean(),
  transcribeEnabled: z.boolean(),
  aiEnabled: z.boolean(),
  /** Read-only: the global AI_ENABLED kill switch (env). */
  globalEnabled: z.boolean(),
  /** Read-only: spent today (PKT day), USD. */
  spentTodayUsd: z.number(),
});
export type AiSettingsDto = z.infer<typeof aiSettingsDto>;

export const aiSettingsInput = z.object({
  standinMode: z.enum(STANDIN_MODES),
  triggerUnackedSeconds: z.number().int().min(10).max(3600),
  dailyCostCapUsd: z.number().min(0).max(1000),
  triageEnabled: z.boolean(),
  transcribeEnabled: z.boolean(),
  aiEnabled: z.boolean(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;

/** Placeholders are numeric ({{1}}, {{2}}) so WhatsApp-approved templates stay compatible (I1.10). */
export const templateAdminDto = z.object({
  id: z.uuid(),
  key: z.string(),
  locale: z.enum(AI_LANGS),
  body: z.string(),
  waTemplateName: z.string().nullable(),
  waTemplateLang: z.string().nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type TemplateAdminDto = z.infer<typeof templateAdminDto>;

const waName = z
  .string()
  .trim()
  .max(80)
  .regex(/^[a-z0-9_]*$/)
  .nullish()
  .transform((v) => v || null);
const waLang = z
  .string()
  .trim()
  .max(10)
  .nullish()
  .transform((v) => v || null);

export const templateInput = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/),
  locale: z.enum(AI_LANGS),
  body: z.string().trim().min(1).max(1024),
  waTemplateName: waName,
  waTemplateLang: waLang,
});
export type TemplateInput = z.input<typeof templateInput>;
export const templatePatch = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  locale: z.enum(AI_LANGS).optional(),
  body: z.string().trim().min(1).max(1024).optional(),
  waTemplateName: waName.optional(),
  waTemplateLang: waLang.optional(),
});

const idParams = z.object({ id: z.uuid() });
const items = <T extends z.ZodType>(t: T) => z.object({ items: z.array(t) });
const ok = z.object({ ok: z.literal(true) });

export const aiEndpoints = {
  settingsGet: endpoint({ method: 'GET', path: '/api/v1/ai/settings', response: aiSettingsDto }),
  settingsPut: endpoint({
    method: 'PUT',
    path: '/api/v1/ai/settings',
    body: aiSettingsInput,
    response: aiSettingsDto,
  }),
  kbList: endpoint({ method: 'GET', path: '/api/v1/ai/knowledge', response: items(kbEntryDto) }),
  kbCreate: endpoint({ method: 'POST', path: '/api/v1/ai/knowledge', body: kbInput, response: kbEntryDto }),
  kbUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/ai/knowledge/:id',
    params: idParams,
    body: kbPatch,
    response: kbEntryDto,
  }),
  kbDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/ai/knowledge/:id',
    params: idParams,
    response: ok,
  }),
  templatesList: endpoint({ method: 'GET', path: '/api/v1/ai/templates', response: items(templateAdminDto) }),
  templatesCreate: endpoint({
    method: 'POST',
    path: '/api/v1/ai/templates',
    body: templateInput,
    response: templateAdminDto,
  }),
  templatesUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/ai/templates/:id',
    params: idParams,
    body: templatePatch,
    response: templateAdminDto,
  }),
  templatesDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/ai/templates/:id',
    params: idParams,
    response: ok,
  }),
  /** F8.3: re-enqueue `ai.transcribe` for a failed voice note. */
  transcribeRetry: endpoint({
    method: 'POST',
    path: '/api/v1/ai/transcribe/:id',
    params: idParams,
    response: ok,
  }),
} as const;
