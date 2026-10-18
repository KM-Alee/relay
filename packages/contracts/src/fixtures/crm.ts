// Fixture builders for crm contracts (13 §4). Owner: Lane B. Pattern: ./users.ts.
// Deterministic and schema-valid (the client parses them with the endpoint's response schema).
import type {
  ActivityDto,
  CompanyDto,
  ContactDto,
  CustomFieldDto,
  OpportunityDto,
  PipelineDto,
  SavedListDto,
  StageDto,
  TagDto,
} from '../api/crm';

const id = (n: number) => `0192f3a0-0000-7000-8000-0000000${String(n).padStart(5, '0')}`;
export const FX = {
  contact: id(1001),
  contact2: id(1002),
  company: id(1101),
  pipeline: id(1201),
  pipeline2: id(1202),
  stages: [id(1301), id(1302), id(1303), id(1304), id(1305)],
  opportunity: id(1401),
  opportunity2: id(1402),
  tag: id(1501),
  tag2: id(1502),
  field: id(1601),
  list: id(1701),
  activity: id(1801),
  owner: id(101),
} as const;
const NOW = '2026-10-18T09:00:00.000Z';

export function buildTag(o: Partial<TagDto> = {}): TagDto {
  return { id: FX.tag, name: 'Solar', contactCount: 3, opportunityCount: 1, ...o };
}

export function buildContact(o: Partial<ContactDto> = {}): ContactDto {
  return {
    id: FX.contact,
    name: 'Ali Raza',
    phoneE164: '+923001234567',
    email: 'ali@example.com',
    companyId: FX.company,
    companyName: 'Raza Traders',
    ownerUserId: FX.owner,
    ownerName: 'Bilal Ahmed',
    language: 'ur-Latn',
    optedOut: false,
    lastActivityAt: NOW,
    tags: [{ id: FX.tag, name: 'Solar' }],
    fields: { [FX.field]: 'Gulberg, Lahore' },
    aiProfile: {},
    version: 0,
    createdAt: NOW,
    ...o,
  };
}

export function buildCompany(o: Partial<CompanyDto> = {}): CompanyDto {
  return {
    id: FX.company,
    name: 'Raza Traders',
    ownerUserId: FX.owner,
    ownerName: 'Bilal Ahmed',
    contactCount: 2,
    fields: {},
    version: 0,
    createdAt: NOW,
    ...o,
  };
}

export function buildOpportunity(o: Partial<OpportunityDto> = {}): OpportunityDto {
  return {
    id: FX.opportunity,
    contactId: FX.contact,
    contactName: 'Ali Raza',
    pipelineId: FX.pipeline,
    stageId: FX.stages[1]!,
    title: '5 kW rooftop system',
    value: { masked: false, amountMinor: 85_000_000, currency: 'PKR' },
    ownerUserId: FX.owner,
    ownerName: 'Bilal Ahmed',
    stageEnteredAt: NOW,
    closedAt: null,
    tags: [],
    fields: {},
    version: 0,
    createdAt: NOW,
    ...o,
  };
}

export function buildStage(i: number, o: Partial<StageDto> = {}): StageDto {
  const names = ['New', 'Qualified', 'Proposal', 'Won', 'Lost'];
  return {
    id: FX.stages[i]!,
    pipelineId: FX.pipeline,
    name: names[i]!,
    position: i,
    kind: i === 3 ? 'won' : i === 4 ? 'lost' : 'open',
    rotSeconds: null,
    requiredFieldIds: [],
    version: 0,
    ...o,
  };
}

export function buildPipeline(o: Partial<PipelineDto> = {}): PipelineDto {
  return {
    id: FX.pipeline,
    name: 'Residential solar',
    teamId: null,
    position: 0,
    isDefault: true,
    version: 0,
    stages: [0, 1, 2, 3, 4].map((i) => buildStage(i)),
    ...o,
  };
}

export function buildField(o: Partial<CustomFieldDto> = {}): CustomFieldDto {
  return {
    id: FX.field,
    entity: 'contact',
    pipelineId: null,
    key: 'site_address',
    label: { en: 'Site address', ur: 'سائٹ کا پتہ' },
    type: 'text',
    options: [],
    position: 0,
    version: 0,
    ...o,
  };
}

export function buildActivity(o: Partial<ActivityDto> = {}): ActivityDto {
  return {
    id: FX.activity,
    type: 'note',
    actorType: 'user',
    actorUserId: FX.owner,
    actorName: 'Bilal Ahmed',
    ai: false,
    opportunityId: null,
    payload: { body: 'Customer wants a site visit on Saturday.' },
    occurredAt: NOW,
    ...o,
  };
}

export function buildSavedList(o: Partial<SavedListDto> = {}): SavedListDto {
  return {
    id: FX.list,
    name: 'Solar leads in Lahore',
    entity: 'contact',
    criteria: { match: 'all', clauses: [{ field: 'tag', op: 'in', value: [FX.tag] }] },
    isShared: false,
    needsReview: false,
    ownerUserId: FX.owner,
    version: 0,
    ...o,
  };
}

const timeline = () => ({ items: [buildActivity()], nextCursor: null });

/** One entry per endpoint in crmEndpoints, used by the api-client in fixture mode. */
export const crmFixtures = {
  contactsList: () => ({
    items: [buildContact(), buildContact({ id: FX.contact2, name: 'Sara Khan' })],
    nextCursor: null,
  }),
  contactsCreate: () => buildContact(),
  contactsGet: () => buildContact(),
  contactsUpdate: () => buildContact({ version: 1 }),
  contactsDelete: () => ({ ok: true as const }),
  contactTimeline: timeline,
  contact360: () => ({
    contact: buildContact(),
    company: buildCompany(),
    opportunities: [buildOpportunity()],
    related: {
      conversations: [{ id: 'c1', label: 'WhatsApp', status: 'open', at: NOW }],
      payments: [],
      appointments: [],
    },
    timeline: timeline(),
  }),
  contactTagAdd: () => buildContact(),
  contactTagRemove: () => buildContact({ tags: [] }),
  companiesList: () => ({ items: [buildCompany()], nextCursor: null }),
  companiesCreate: () => buildCompany(),
  companiesGet: () => buildCompany(),
  companiesUpdate: () => buildCompany({ version: 1 }),
  companiesDelete: () => ({ ok: true as const }),
  opportunitiesList: () => ({ items: [buildOpportunity()], nextCursor: null }),
  opportunitiesCreate: () => buildOpportunity(),
  opportunitiesGet: () => buildOpportunity(),
  opportunitiesUpdate: () => buildOpportunity({ version: 1 }),
  opportunitiesDelete: () => ({ ok: true as const }),
  opportunitiesMove: () => buildOpportunity({ stageId: FX.stages[2]!, version: 1 }),
  opportunityTagAdd: () => buildOpportunity(),
  opportunityTagRemove: () => buildOpportunity(),
  opportunityTimeline: timeline,
  pipelinesList: () => ({ items: [buildPipeline()] }),
  pipelinesCreate: () => buildPipeline(),
  pipelinesUpdate: () => buildPipeline({ version: 1 }),
  pipelinesDelete: () => ({ ok: true as const }),
  pipelinesBoard: () => ({
    pipeline: buildPipeline(),
    columns: buildPipeline().stages.map((stage, i) => ({
      stage,
      count: i === 1 ? 1 : 0,
      total: { value: i === 1 ? 85_000_000 : 0, masked: false },
      opportunities: i === 1 ? [buildOpportunity()] : [],
    })),
  }),
  stagesCreate: () => buildPipeline(),
  stagesReorder: () => buildPipeline(),
  stagesUpdate: () => buildPipeline(),
  stagesDelete: () => ({ ok: true as const, movedCount: 0 }),
  fieldsList: () => ({ items: [buildField()] }),
  fieldsCreate: () => buildField(),
  fieldsUpdate: () => buildField({ version: 1 }),
  fieldsDelete: () => ({ ok: true as const }),
  tagsList: () => ({
    items: [buildTag(), buildTag({ id: FX.tag2, name: 'Villa', contactCount: 1, opportunityCount: 0 })],
  }),
  tagsCreate: () => buildTag(),
  tagsUpdate: () => buildTag(),
  tagsDelete: () => ({ ok: true as const }),
  listsList: () => ({ items: [buildSavedList()] }),
  listsCreate: () => buildSavedList(),
  listsUpdate: () => buildSavedList({ version: 1 }),
  listsDelete: () => ({ ok: true as const }),
  listsItems: () => ({ entity: 'contact' as const, total: 1, items: [buildContact()], nextCursor: null }),
  activitiesCreate: () => buildActivity(),
  exportsCreate: () => 'name,phone\r\nAli Raza,+923001234567\r\n',
} as const;
