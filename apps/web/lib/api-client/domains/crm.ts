// api.crm.*: owner Lane B. One method per endpoint in contracts/api/crm.ts; pattern: ./users.ts.
import { crmEndpoints as e } from '@relay/contracts/api/crm';
import { crmFixtures as f } from '@relay/contracts/fixtures/crm';
import { buildPath } from '../http';
import { call, type CallOptions } from '../http';
import { readApiError } from '@/lib/http/client-error';

type In<K extends keyof typeof e> = Parameters<typeof call<(typeof e)[K]>>[2];
const run = <K extends keyof typeof e>(k: K, input: In<K>, opts?: CallOptions) =>
  call('crm', e[k], input, f[k] as never, opts) as ReturnType<typeof call<(typeof e)[K]>>;

export const crm = {
  contacts: {
    list: (query: In<'contactsList'>['query'] = {}, o?: CallOptions) =>
      run('contactsList', { query } as In<'contactsList'>, o),
    create: (body: In<'contactsCreate'>['body'], o?: CallOptions) =>
      run('contactsCreate', { body } as In<'contactsCreate'>, o),
    get: (id: string, o?: CallOptions) => run('contactsGet', { params: { id } } as In<'contactsGet'>, o),
    update: (id: string, body: In<'contactsUpdate'>['body'], o?: CallOptions) =>
      run('contactsUpdate', { params: { id }, body } as In<'contactsUpdate'>, o),
    delete: (id: string, o?: CallOptions) =>
      run('contactsDelete', { params: { id } } as In<'contactsDelete'>, o),
    timeline: (id: string, query: In<'contactTimeline'>['query'] = {}, o?: CallOptions) =>
      run('contactTimeline', { params: { id }, query } as In<'contactTimeline'>, o),
    view360: (id: string, o?: CallOptions) => run('contact360', { params: { id } } as In<'contact360'>, o),
    addTag: (id: string, tagId: string, o?: CallOptions) =>
      run('contactTagAdd', { params: { id }, body: { tagId } } as In<'contactTagAdd'>, o),
    removeTag: (id: string, tagId: string, o?: CallOptions) =>
      run('contactTagRemove', { params: { id, tagId } } as In<'contactTagRemove'>, o),
  },
  companies: {
    list: (query: In<'companiesList'>['query'] = {}, o?: CallOptions) =>
      run('companiesList', { query } as In<'companiesList'>, o),
    create: (body: In<'companiesCreate'>['body'], o?: CallOptions) =>
      run('companiesCreate', { body } as In<'companiesCreate'>, o),
    get: (id: string, o?: CallOptions) => run('companiesGet', { params: { id } } as In<'companiesGet'>, o),
    update: (id: string, body: In<'companiesUpdate'>['body'], o?: CallOptions) =>
      run('companiesUpdate', { params: { id }, body } as In<'companiesUpdate'>, o),
    delete: (id: string, o?: CallOptions) =>
      run('companiesDelete', { params: { id } } as In<'companiesDelete'>, o),
  },
  opportunities: {
    list: (query: In<'opportunitiesList'>['query'] = {}, o?: CallOptions) =>
      run('opportunitiesList', { query } as In<'opportunitiesList'>, o),
    create: (body: In<'opportunitiesCreate'>['body'], o?: CallOptions) =>
      run('opportunitiesCreate', { body } as In<'opportunitiesCreate'>, o),
    get: (id: string, o?: CallOptions) =>
      run('opportunitiesGet', { params: { id } } as In<'opportunitiesGet'>, o),
    update: (id: string, body: In<'opportunitiesUpdate'>['body'], o?: CallOptions) =>
      run('opportunitiesUpdate', { params: { id }, body } as In<'opportunitiesUpdate'>, o),
    delete: (id: string, o?: CallOptions) =>
      run('opportunitiesDelete', { params: { id } } as In<'opportunitiesDelete'>, o),
    move: (id: string, body: In<'opportunitiesMove'>['body'], o?: CallOptions) =>
      run('opportunitiesMove', { params: { id }, body } as In<'opportunitiesMove'>, o),
    addTag: (id: string, tagId: string, o?: CallOptions) =>
      run('opportunityTagAdd', { params: { id }, body: { tagId } } as In<'opportunityTagAdd'>, o),
    removeTag: (id: string, tagId: string, o?: CallOptions) =>
      run('opportunityTagRemove', { params: { id, tagId } } as In<'opportunityTagRemove'>, o),
    timeline: (id: string, query: In<'opportunityTimeline'>['query'] = {}, o?: CallOptions) =>
      run('opportunityTimeline', { params: { id }, query } as In<'opportunityTimeline'>, o),
  },
  pipelines: {
    list: (o?: CallOptions) => run('pipelinesList', {} as In<'pipelinesList'>, o),
    create: (body: In<'pipelinesCreate'>['body'], o?: CallOptions) =>
      run('pipelinesCreate', { body } as In<'pipelinesCreate'>, o),
    update: (id: string, body: In<'pipelinesUpdate'>['body'], o?: CallOptions) =>
      run('pipelinesUpdate', { params: { id }, body } as In<'pipelinesUpdate'>, o),
    delete: (id: string, o?: CallOptions) =>
      run('pipelinesDelete', { params: { id } } as In<'pipelinesDelete'>, o),
    board: (id: string, query: In<'pipelinesBoard'>['query'] = {}, o?: CallOptions) =>
      run('pipelinesBoard', { params: { id }, query } as In<'pipelinesBoard'>, o),
    addStage: (id: string, body: In<'stagesCreate'>['body'], o?: CallOptions) =>
      run('stagesCreate', { params: { id }, body } as In<'stagesCreate'>, o),
    reorderStages: (id: string, stageIds: string[], o?: CallOptions) =>
      run('stagesReorder', { params: { id }, body: { stageIds } } as In<'stagesReorder'>, o),
    updateStage: (id: string, body: In<'stagesUpdate'>['body'], o?: CallOptions) =>
      run('stagesUpdate', { params: { id }, body } as In<'stagesUpdate'>, o),
    deleteStage: (id: string, moveToStageId?: string, o?: CallOptions) =>
      run('stagesDelete', { params: { id }, body: { moveToStageId } } as In<'stagesDelete'>, o),
  },
  fields: {
    list: (query: In<'fieldsList'>['query'] = {}, o?: CallOptions) =>
      run('fieldsList', { query } as In<'fieldsList'>, o),
    create: (body: In<'fieldsCreate'>['body'], o?: CallOptions) =>
      run('fieldsCreate', { body } as In<'fieldsCreate'>, o),
    update: (id: string, body: In<'fieldsUpdate'>['body'], o?: CallOptions) =>
      run('fieldsUpdate', { params: { id }, body } as In<'fieldsUpdate'>, o),
    delete: (id: string, o?: CallOptions) => run('fieldsDelete', { params: { id } } as In<'fieldsDelete'>, o),
  },
  tags: {
    list: (o?: CallOptions) => run('tagsList', {} as In<'tagsList'>, o),
    create: (name: string, o?: CallOptions) => run('tagsCreate', { body: { name } } as In<'tagsCreate'>, o),
    rename: (id: string, name: string, o?: CallOptions) =>
      run('tagsUpdate', { params: { id }, body: { name } } as In<'tagsUpdate'>, o),
    delete: (id: string, o?: CallOptions) => run('tagsDelete', { params: { id } } as In<'tagsDelete'>, o),
  },
  lists: {
    list: (o?: CallOptions) => run('listsList', {} as In<'listsList'>, o),
    create: (body: In<'listsCreate'>['body'], o?: CallOptions) =>
      run('listsCreate', { body } as In<'listsCreate'>, o),
    update: (id: string, body: In<'listsUpdate'>['body'], o?: CallOptions) =>
      run('listsUpdate', { params: { id }, body } as In<'listsUpdate'>, o),
    delete: (id: string, o?: CallOptions) => run('listsDelete', { params: { id } } as In<'listsDelete'>, o),
    items: (id: string, query: In<'listsItems'>['query'] = {}, o?: CallOptions) =>
      run('listsItems', { params: { id }, query } as In<'listsItems'>, o),
  },
  activities: {
    create: (body: In<'activitiesCreate'>['body'], o?: CallOptions) =>
      run('activitiesCreate', { body } as In<'activitiesCreate'>, o),
  },
  /** POST /exports → CSV text (the response is not JSON, so this bypasses `call`). */
  exportCsv: async (body: In<'exportsCreate'>['body'], opts: CallOptions = {}): Promise<string> => {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const read = () => document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/)?.[1];
    if (!read()) await fetchImpl('/api/v1/csrf', { credentials: 'same-origin' });
    const token = read();
    const res = await fetchImpl(buildPath(e.exportsCreate.path), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-csrf-token': decodeURIComponent(token) } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await readApiError(res);
    return res.text();
  },
};
