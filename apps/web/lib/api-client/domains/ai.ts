// api.ai.*: owner Lane C. One method per endpoint in contracts/api/ai.ts.
import { aiEndpoints as e } from '@relay/contracts/api/ai';
import { aiFixtures as f } from '@relay/contracts/fixtures/ai';
import { call, type CallOptions } from '../http';

type In<K extends keyof typeof e> = Parameters<typeof call<(typeof e)[K]>>[2];
const run = <K extends keyof typeof e>(k: K, input: In<K>, opts?: CallOptions) =>
  call('ai', e[k], input, f[k] as never, opts) as ReturnType<typeof call<(typeof e)[K]>>;

export const ai = {
  settings: {
    get: (o?: CallOptions) => run('settingsGet', {} as In<'settingsGet'>, o),
    put: (body: In<'settingsPut'>['body'], o?: CallOptions) =>
      run('settingsPut', { body } as In<'settingsPut'>, o),
  },
  knowledge: {
    list: (o?: CallOptions) => run('kbList', {} as In<'kbList'>, o),
    create: (body: In<'kbCreate'>['body'], o?: CallOptions) => run('kbCreate', { body } as In<'kbCreate'>, o),
    update: (id: string, body: In<'kbUpdate'>['body'], o?: CallOptions) =>
      run('kbUpdate', { params: { id }, body } as In<'kbUpdate'>, o),
    delete: (id: string, o?: CallOptions) => run('kbDelete', { params: { id } } as In<'kbDelete'>, o),
  },
  templates: {
    list: (o?: CallOptions) => run('templatesList', {} as In<'templatesList'>, o),
    create: (body: In<'templatesCreate'>['body'], o?: CallOptions) =>
      run('templatesCreate', { body } as In<'templatesCreate'>, o),
    update: (id: string, body: In<'templatesUpdate'>['body'], o?: CallOptions) =>
      run('templatesUpdate', { params: { id }, body } as In<'templatesUpdate'>, o),
    delete: (id: string, o?: CallOptions) =>
      run('templatesDelete', { params: { id } } as In<'templatesDelete'>, o),
  },
  transcribeRetry: (messageId: string, o?: CallOptions) =>
    run('transcribeRetry', { params: { id: messageId } } as In<'transcribeRetry'>, o),
};
