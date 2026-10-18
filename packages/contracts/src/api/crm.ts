// crm API contracts: Zod request/response schemas + endpoint descriptors (docs/11-api.md "CRM"). Owner: Lane B.
// Covers T-110…T-118: contacts/companies/opportunities, pipelines/stages/board, custom fields, tags, saved
// lists + filters, activities, contact 360, CSV export. Pattern: see ./users.ts.
import { z } from 'zod';
import { moneyFigureSchema, moneySchema } from '../money';
import { endpoint } from './endpoint';

// ── Shared primitives ───────────────────────────────────────────────────
export const idParams = z.object({ id: z.uuid() });
export const crmEntitySchema = z.enum(['contact', 'company', 'opportunity']);
export type CrmEntity = z.infer<typeof crmEntitySchema>;
export const isoDate = z.iso.datetime({ offset: true });
const nullableIso = isoDate.nullable();
export const versionSchema = z.number().int().min(0);
export const localizedLabel = z.object({ en: z.string().min(1).max(80), ur: z.string().min(1).max(80) });
export type LocalizedLabel = z.infer<typeof localizedLabel>;

/** Custom-field value on the wire: text, number, ISO date (YYYY-MM-DD), dropdown value, checkbox. */
export const fieldValueSchema = z.union([z.string().max(2000), z.number(), z.boolean()]);
export type FieldValue = z.infer<typeof fieldValueSchema>;
/** `{ [fieldId]: value }`; `null` clears a value. */
export const fieldValuesInput = z.record(z.uuid(), fieldValueSchema.nullable());
export const fieldValuesOutput = z.record(z.uuid(), fieldValueSchema);

/** Pakistani-friendly E.164 normalisation: "0300 1234567" → "+923001234567". Null = not a phone number. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s\-().]/g, '');
  let e164: string;
  if (/^\+[1-9]\d{6,14}$/.test(s)) e164 = s;
  else if (/^00[1-9]\d{6,14}$/.test(s)) e164 = `+${s.slice(2)}`;
  else if (/^0\d{10}$/.test(s)) e164 = `+92${s.slice(1)}`;
  else if (/^92\d{10}$/.test(s)) e164 = `+${s}`;
  else return null;
  return e164;
}
const phoneInput = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: 'custom', message: 'phone_invalid' });
    return p ?? '';
  });

export const pageQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Free-text search over name / phone / email / title. */
  q: z.string().trim().max(100).optional(),
  /** base64url JSON `Criteria` (same schema as saved lists, F2.6). Server-validated. */
  filter: z.string().max(8000).optional(),
});
export type PageQuery = z.input<typeof pageQuery>;
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

// ── Filters / criteria (F2.6, Q9) ───────────────────────────────────────
const uuidList = z.array(z.uuid()).min(1).max(50);
const dateOps = z.enum(['before', 'after', 'older_than_days', 'within_days']);
const dateClause = (field: 'created_at' | 'last_activity_at' | 'stage_entered_at') =>
  z.object({
    field: z.literal(field),
    op: dateOps,
    /** ISO date for before/after, whole days for older_than_days/within_days. */
    value: z.union([z.iso.date(), z.number().int().min(0).max(3650)]),
  });
export const criteriaClause = z.discriminatedUnion('field', [
  z.object({ field: z.literal('tag'), op: z.enum(['in', 'not_in']), value: uuidList }),
  // `in` / `not_in` need a value (checked in the service); `unassigned` takes none.
  z.object({
    field: z.literal('owner'),
    op: z.enum(['in', 'not_in', 'unassigned']),
    value: uuidList.optional(),
  }),
  z.object({ field: z.literal('stage'), op: z.enum(['in', 'not_in']), value: uuidList }),
  z.object({ field: z.literal('pipeline'), op: z.literal('in'), value: uuidList }),
  z.object({ field: z.literal('company'), op: z.literal('in'), value: uuidList }),
  z.object({
    field: z.literal('name'),
    op: z.enum(['contains', 'equals']),
    value: z.string().min(1).max(100),
  }),
  z.object({
    field: z.literal('value'),
    op: z.enum(['gte', 'lte']),
    value: z.number().int().min(0),
  }),
  dateClause('created_at'),
  dateClause('last_activity_at'),
  dateClause('stage_entered_at'),
  z.object({
    field: z.literal('custom'),
    fieldId: z.uuid(),
    op: z.enum([
      'eq',
      'neq',
      'contains',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'is_empty',
      'not_empty',
      'older_than_days',
      'within_days',
    ]),
    value: z
      .union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)])
      .optional(),
  }),
]);
export type CriteriaClause = z.infer<typeof criteriaClause>;
export const criteriaSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  clauses: z.array(criteriaClause).max(20),
});
export type Criteria = z.infer<typeof criteriaSchema>;

/** `?filter=` transport: base64url(JSON). */
export function encodeFilter(c: z.input<typeof criteriaSchema>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(c));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeFilter(s: string): unknown {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

// ── Tags (F2.1) ─────────────────────────────────────────────────────────
export const tagRef = z.object({ id: z.uuid(), name: z.string() });
export const tagDto = tagRef.extend({ contactCount: z.number().int(), opportunityCount: z.number().int() });
export type TagDto = z.infer<typeof tagDto>;
export const tagInput = z.object({ name: z.string().trim().min(1).max(40) });
export const tagUpdateInput = tagInput.extend({});
export const attachTagInput = z.object({ tagId: z.uuid() });
export const tagAttachParams = z.object({ id: z.uuid(), tagId: z.uuid() });

// ── Custom fields (F2.2, F2.3) ──────────────────────────────────────────
export const fieldTypeSchema = z.enum(['text', 'number', 'date', 'dropdown', 'checkbox', 'ai']);
export const fieldOption = z.object({ value: z.string().min(1).max(60), label: localizedLabel });
/** AI field (F9.1): what to extract and the shape of the answer. Only on `type: 'ai'` fields. */
export const aiOutputTypeSchema = z.enum(['text', 'dropdown', 'number']);
export const aiConfigSchema = z.object({
  prompt: z.string().trim().min(5).max(500),
  outputType: aiOutputTypeSchema,
});
export type AiConfig = z.infer<typeof aiConfigSchema>;
export const customFieldDto = z.object({
  id: z.uuid(),
  entity: crmEntitySchema,
  /** null = shared across pipelines; set = only on that pipeline's opportunities. */
  pipelineId: z.uuid().nullable(),
  key: z.string(),
  label: localizedLabel,
  type: fieldTypeSchema,
  options: z.array(fieldOption),
  /** Prompt + output type for `ai` fields; null/absent otherwise. */
  aiConfig: aiConfigSchema.nullable().optional(),
  position: z.number().int(),
  version: versionSchema,
});
export type CustomFieldDto = z.infer<typeof customFieldDto>;
export const customFieldInput = z.object({
  entity: crmEntitySchema,
  pipelineId: z.uuid().nullable().default(null),
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: localizedLabel,
  type: fieldTypeSchema,
  options: z.array(fieldOption).max(50).default([]),
  /** Required for `type: 'ai'`. */
  aiConfig: aiConfigSchema.nullish(),
});
export const customFieldUpdateInput = z.object({
  label: localizedLabel.optional(),
  options: z.array(fieldOption).max(50).optional(),
  aiConfig: aiConfigSchema.optional(),
  position: z.number().int().min(0).optional(),
  version: versionSchema,
});
export const customFieldsQuery = z.object({
  entity: crmEntitySchema.optional(),
  /** Only fields that apply to this pipeline: shared + that pipeline's. */
  pipelineId: z.uuid().optional(),
});

// ── Pipelines & stages (F2.5) ───────────────────────────────────────────
export const stageKindSchema = z.enum(['open', 'won', 'lost']);
export const stageDto = z.object({
  id: z.uuid(),
  pipelineId: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  kind: stageKindSchema,
  rotSeconds: z.number().int().nullable(),
  /** Custom fields that must be filled before an opportunity may enter this stage (F2.4). */
  requiredFieldIds: z.array(z.uuid()),
  version: versionSchema,
});
export type StageDto = z.infer<typeof stageDto>;
export const pipelineDto = z.object({
  id: z.uuid(),
  name: z.string(),
  teamId: z.uuid().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
  version: versionSchema,
  stages: z.array(stageDto),
});
export type PipelineDto = z.infer<typeof pipelineDto>;
export const pipelinesResponse = z.object({ items: z.array(pipelineDto) });
export const pipelineInput = z.object({
  name: z.string().trim().min(1).max(60),
  teamId: z.uuid().nullable().optional(),
  /** Optional initial stages (names); default: New, Qualified, Proposal, Won, Lost. */
  stages: z
    .array(z.object({ name: z.string().trim().min(1).max(60), kind: stageKindSchema.default('open') }))
    .max(20)
    .optional(),
});
export const pipelineUpdateInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  teamId: z.uuid().nullable().optional(),
  isDefault: z.literal(true).optional(),
  version: versionSchema,
});
export const stageInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: stageKindSchema.default('open'),
  requiredFieldIds: z.array(z.uuid()).max(30).default([]),
});
export const stageUpdateInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: stageKindSchema.optional(),
  requiredFieldIds: z.array(z.uuid()).max(30).optional(),
  /** Rot period in seconds (F2.9); null clears it. Open stages only. */
  rotSeconds: z.number().int().min(1).max(31_536_000).nullable().optional(),
  version: versionSchema,
});
export const stageReorderInput = z.object({ stageIds: z.array(z.uuid()).min(1).max(30) });
export const stageDeleteInput = z.object({ moveToStageId: z.uuid().optional() });
export const stageDeleteResponse = z.object({ ok: z.literal(true), movedCount: z.number().int() });

// ── Contacts / companies / opportunities (F2.1) ─────────────────────────
export const languageSchema = z.enum(['en', 'ur', 'ur-Latn']);
export const contactDto = z.object({
  id: z.uuid(),
  name: z.string(),
  phoneE164: z.string().nullable(),
  email: z.string().nullable(),
  companyId: z.uuid().nullable(),
  companyName: z.string().nullable(),
  ownerUserId: z.uuid().nullable(),
  ownerName: z.string().nullable(),
  language: languageSchema.nullable(),
  optedOut: z.boolean(),
  lastActivityAt: nullableIso,
  tags: z.array(tagRef),
  fields: fieldValuesOutput,
  /** AI-collected profile (F2.8); filled by the AI lane. */
  aiProfile: z.record(z.string(), z.unknown()),
  version: versionSchema,
  createdAt: isoDate,
});
export type ContactDto = z.infer<typeof contactDto>;
export const contactsResponse = page(contactDto);
export const contactInput = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneInput.nullish(),
  email: z.email().max(200).nullish(),
  companyId: z.uuid().nullish(),
  ownerUserId: z.uuid().nullish(),
  language: languageSchema.nullish(),
  fields: fieldValuesInput.optional(),
});
export const contactUpdateInput = contactInput.partial().extend({ version: versionSchema });

export const companyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  ownerUserId: z.uuid().nullable(),
  ownerName: z.string().nullable(),
  contactCount: z.number().int(),
  fields: fieldValuesOutput,
  version: versionSchema,
  createdAt: isoDate,
});
export type CompanyDto = z.infer<typeof companyDto>;
export const companiesResponse = page(companyDto);
export const companyInput = z.object({
  name: z.string().trim().min(1).max(120),
  ownerUserId: z.uuid().nullish(),
  fields: fieldValuesInput.optional(),
});
export const companyUpdateInput = companyInput.partial().extend({ version: versionSchema });

export const opportunityDto = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string(),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  title: z.string(),
  /** `{ masked:true }` without `crm.opportunity.value.view` (F1.4); null = no value set. */
  value: moneySchema.nullable(),
  ownerUserId: z.uuid().nullable(),
  ownerName: z.string().nullable(),
  stageEnteredAt: isoDate,
  closedAt: nullableIso,
  tags: z.array(tagRef),
  fields: fieldValuesOutput,
  version: versionSchema,
  createdAt: isoDate,
});
export type OpportunityDto = z.infer<typeof opportunityDto>;
export const opportunitiesResponse = page(opportunityDto);
export const opportunitiesQuery = pageQuery.extend({
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  contactId: z.uuid().optional(),
});
export const contactsQuery = pageQuery.extend({ companyId: z.uuid().optional() });
export const opportunityInput = z.object({
  contactId: z.uuid(),
  pipelineId: z.uuid().optional(),
  /** Defaults to the pipeline's first stage. */
  stageId: z.uuid().optional(),
  title: z.string().trim().min(1).max(160),
  /** Minor units. Needs `crm.opportunity.value.view` (you cannot set what you cannot see). */
  valueMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullish(),
  currency: z.string().length(3).optional(),
  ownerUserId: z.uuid().nullish(),
  fields: fieldValuesInput.optional(),
});
export const opportunityUpdateInput = opportunityInput
  .omit({ contactId: true, pipelineId: true, stageId: true })
  .partial()
  .extend({ version: versionSchema });
export const opportunityMoveInput = z.object({
  stageId: z.uuid(),
  version: versionSchema,
  /** Fill missing required fields in the same request (F2.4). */
  fields: fieldValuesInput.optional(),
});
export const requiredFieldsDetails = z.object({
  stageId: z.uuid(),
  fields: z.array(
    z.object({ fieldId: z.uuid(), key: z.string(), label: localizedLabel, entity: crmEntitySchema }),
  ),
});
export const okResponse = z.object({ ok: z.literal(true) });

// ── Board (F2.5) ────────────────────────────────────────────────────────
export const boardQuery = z.object({
  filter: z.string().max(8000).optional(),
  q: z.string().trim().max(100).optional(),
});
export const boardColumn = z.object({
  stage: stageDto,
  count: z.number().int(),
  /** Column total; masked without the value permission. */
  total: moneyFigureSchema,
  opportunities: z.array(opportunityDto),
});
export const boardResponse = z.object({
  pipeline: pipelineDto,
  columns: z.array(boardColumn),
  /** Rotting cards (F2.9): opportunity id -> idle seconds (time-warp scaled), only those past their stage's rot period. */
  rotting: z.record(z.uuid(), z.number().int()).optional(),
});

// ── Activities / timeline (F2.7, F2.13) ─────────────────────────────────
export const activityTypeSchema = z.enum([
  'note',
  'call',
  'stage_change',
  'assignment',
  'field_edit',
  'message_in',
  'message_out',
  'ai_message',
  'payment',
  'appointment',
  'import',
  'system',
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;
export const activityDto = z.object({
  id: z.uuid(),
  type: activityTypeSchema,
  actorType: z.enum(['user', 'system', 'ai']),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  /** True for AI-authored entries: the UI shows the AI label (F6, F2.7). */
  ai: z.boolean(),
  opportunityId: z.uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: isoDate,
});
export type ActivityDto = z.infer<typeof activityDto>;
export const timelineResponse = page(activityDto);
export const timelineQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const activityInput = z
  .object({
    contactId: z.uuid().optional(),
    opportunityId: z.uuid().optional(),
    type: z.enum(['note', 'call']),
    /** Note text, or the call summary. */
    body: z.string().trim().min(1).max(5000),
    direction: z.enum(['inbound', 'outbound']).optional(),
    outcome: z.enum(['connected', 'no_answer', 'voicemail', 'busy', 'wrong_number']).optional(),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
  })
  .refine((v) => v.contactId || v.opportunityId, { message: 'target_required' })
  .refine((v) => v.type !== 'call' || (v.direction && v.outcome), { message: 'call_details_required' });

// ── Contact 360 (F2.8) ──────────────────────────────────────────────────
export const relatedItem = z.object({
  id: z.string(),
  label: z.string(),
  status: z.string().nullable(),
  at: nullableIso,
});
export const contact360Response = z.object({
  contact: contactDto,
  company: companyDto.nullable(),
  opportunities: z.array(opportunityDto),
  /** Filled by the messaging / payments / calendar lanes through the provider registry. */
  related: z.object({
    conversations: z.array(relatedItem),
    payments: z.array(relatedItem),
    appointments: z.array(relatedItem),
  }),
  timeline: timelineResponse,
});

// ── Saved lists (F2.6) ──────────────────────────────────────────────────
export const savedListDto = z.object({
  id: z.uuid(),
  name: z.string(),
  entity: crmEntitySchema,
  criteria: criteriaSchema,
  isShared: z.boolean(),
  /** A field/tag the list used was deleted; the clause was dropped (02 §3). */
  needsReview: z.boolean(),
  ownerUserId: z.uuid(),
  version: versionSchema,
});
export type SavedListDto = z.infer<typeof savedListDto>;
export const savedListsResponse = z.object({ items: z.array(savedListDto) });
export const savedListInput = z.object({
  name: z.string().trim().min(1).max(80),
  entity: crmEntitySchema,
  criteria: criteriaSchema,
  isShared: z.boolean().default(false),
});
export const savedListUpdateInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  criteria: criteriaSchema.optional(),
  isShared: z.boolean().optional(),
  version: versionSchema,
});
/** Items are the entity's DTOs; the entity is in the list. */
export const savedListItemsResponse = z.object({
  entity: crmEntitySchema,
  total: z.number().int(),
  items: z.array(z.union([contactDto, companyDto, opportunityDto])),
  nextCursor: z.string().nullable(),
});
export const savedListItemsQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ── Export (F2.11) ──────────────────────────────────────────────────────
export const exportInput = z
  .object({
    entity: crmEntitySchema.optional(),
    savedListId: z.uuid().optional(),
    filter: z.string().max(8000).optional(),
  })
  .refine((v) => Boolean(v.entity) !== Boolean(v.savedListId), { message: 'entity_xor_list' });

// ── Endpoints ───────────────────────────────────────────────────────────
const csv = z.string();
export const crmEndpoints = {
  // contacts
  contactsList: endpoint({
    method: 'GET',
    path: '/api/v1/contacts',
    query: contactsQuery,
    response: contactsResponse,
  }),
  contactsCreate: endpoint({
    method: 'POST',
    path: '/api/v1/contacts',
    body: contactInput,
    response: contactDto,
  }),
  contactsGet: endpoint({
    method: 'GET',
    path: '/api/v1/contacts/:id',
    params: idParams,
    response: contactDto,
  }),
  contactsUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/contacts/:id',
    params: idParams,
    body: contactUpdateInput,
    response: contactDto,
  }),
  contactsDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/contacts/:id',
    params: idParams,
    response: okResponse,
  }),
  contactTimeline: endpoint({
    method: 'GET',
    path: '/api/v1/contacts/:id/timeline',
    params: idParams,
    query: timelineQuery,
    response: timelineResponse,
  }),
  contact360: endpoint({
    method: 'GET',
    path: '/api/v1/contacts/:id/360',
    params: idParams,
    response: contact360Response,
  }),
  contactTagAdd: endpoint({
    method: 'POST',
    path: '/api/v1/contacts/:id/tags',
    params: idParams,
    body: attachTagInput,
    response: contactDto,
  }),
  contactTagRemove: endpoint({
    method: 'DELETE',
    path: '/api/v1/contacts/:id/tags/:tagId',
    params: tagAttachParams,
    response: contactDto,
  }),
  // companies
  companiesList: endpoint({
    method: 'GET',
    path: '/api/v1/companies',
    query: pageQuery,
    response: companiesResponse,
  }),
  companiesCreate: endpoint({
    method: 'POST',
    path: '/api/v1/companies',
    body: companyInput,
    response: companyDto,
  }),
  companiesGet: endpoint({
    method: 'GET',
    path: '/api/v1/companies/:id',
    params: idParams,
    response: companyDto,
  }),
  companiesUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/companies/:id',
    params: idParams,
    body: companyUpdateInput,
    response: companyDto,
  }),
  companiesDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/companies/:id',
    params: idParams,
    response: okResponse,
  }),
  // opportunities
  opportunitiesList: endpoint({
    method: 'GET',
    path: '/api/v1/opportunities',
    query: opportunitiesQuery,
    response: opportunitiesResponse,
  }),
  opportunitiesCreate: endpoint({
    method: 'POST',
    path: '/api/v1/opportunities',
    body: opportunityInput,
    response: opportunityDto,
  }),
  opportunitiesGet: endpoint({
    method: 'GET',
    path: '/api/v1/opportunities/:id',
    params: idParams,
    response: opportunityDto,
  }),
  opportunitiesUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/opportunities/:id',
    params: idParams,
    body: opportunityUpdateInput,
    response: opportunityDto,
  }),
  opportunitiesDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/opportunities/:id',
    params: idParams,
    response: okResponse,
  }),
  opportunitiesMove: endpoint({
    method: 'POST',
    path: '/api/v1/opportunities/:id/move',
    params: idParams,
    body: opportunityMoveInput,
    response: opportunityDto,
  }),
  opportunityTagAdd: endpoint({
    method: 'POST',
    path: '/api/v1/opportunities/:id/tags',
    params: idParams,
    body: attachTagInput,
    response: opportunityDto,
  }),
  opportunityTagRemove: endpoint({
    method: 'DELETE',
    path: '/api/v1/opportunities/:id/tags/:tagId',
    params: tagAttachParams,
    response: opportunityDto,
  }),
  opportunityTimeline: endpoint({
    method: 'GET',
    path: '/api/v1/opportunities/:id/timeline',
    params: idParams,
    query: timelineQuery,
    response: timelineResponse,
  }),
  // pipelines & stages
  pipelinesList: endpoint({ method: 'GET', path: '/api/v1/pipelines', response: pipelinesResponse }),
  pipelinesCreate: endpoint({
    method: 'POST',
    path: '/api/v1/pipelines',
    body: pipelineInput,
    response: pipelineDto,
  }),
  pipelinesUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/pipelines/:id',
    params: idParams,
    body: pipelineUpdateInput,
    response: pipelineDto,
  }),
  pipelinesDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/pipelines/:id',
    params: idParams,
    response: okResponse,
  }),
  pipelinesBoard: endpoint({
    method: 'GET',
    path: '/api/v1/pipelines/:id/board',
    params: idParams,
    query: boardQuery,
    response: boardResponse,
  }),
  stagesCreate: endpoint({
    method: 'POST',
    path: '/api/v1/pipelines/:id/stages',
    params: idParams,
    body: stageInput,
    response: pipelineDto,
  }),
  stagesReorder: endpoint({
    method: 'POST',
    path: '/api/v1/pipelines/:id/stages/reorder',
    params: idParams,
    body: stageReorderInput,
    response: pipelineDto,
  }),
  stagesUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/stages/:id',
    params: idParams,
    body: stageUpdateInput,
    response: pipelineDto,
  }),
  stagesDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/stages/:id',
    params: idParams,
    body: stageDeleteInput,
    response: stageDeleteResponse,
  }),
  // custom fields
  fieldsList: endpoint({
    method: 'GET',
    path: '/api/v1/custom-fields',
    query: customFieldsQuery,
    response: z.object({ items: z.array(customFieldDto) }),
  }),
  fieldsCreate: endpoint({
    method: 'POST',
    path: '/api/v1/custom-fields',
    body: customFieldInput,
    response: customFieldDto,
  }),
  fieldsUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/custom-fields/:id',
    params: idParams,
    body: customFieldUpdateInput,
    response: customFieldDto,
  }),
  fieldsDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/custom-fields/:id',
    params: idParams,
    response: okResponse,
  }),
  // tags
  tagsList: endpoint({ method: 'GET', path: '/api/v1/tags', response: z.object({ items: z.array(tagDto) }) }),
  tagsCreate: endpoint({ method: 'POST', path: '/api/v1/tags', body: tagInput, response: tagDto }),
  tagsUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/tags/:id',
    params: idParams,
    body: tagUpdateInput,
    response: tagDto,
  }),
  tagsDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/tags/:id',
    params: idParams,
    response: okResponse,
  }),
  // saved lists
  listsList: endpoint({ method: 'GET', path: '/api/v1/saved-lists', response: savedListsResponse }),
  listsCreate: endpoint({
    method: 'POST',
    path: '/api/v1/saved-lists',
    body: savedListInput,
    response: savedListDto,
  }),
  listsUpdate: endpoint({
    method: 'PATCH',
    path: '/api/v1/saved-lists/:id',
    params: idParams,
    body: savedListUpdateInput,
    response: savedListDto,
  }),
  listsDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/saved-lists/:id',
    params: idParams,
    response: okResponse,
  }),
  listsItems: endpoint({
    method: 'GET',
    path: '/api/v1/saved-lists/:id/items',
    params: idParams,
    query: savedListItemsQuery,
    response: savedListItemsResponse,
  }),
  // activities + export
  activitiesCreate: endpoint({
    method: 'POST',
    path: '/api/v1/activities',
    body: activityInput,
    response: activityDto,
  }),
  exportsCreate: endpoint({ method: 'POST', path: '/api/v1/exports', body: exportInput, response: csv }),
} as const;
