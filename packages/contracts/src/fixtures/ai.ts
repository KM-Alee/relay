// Fixture builders for ai contracts (13 §4). Owner: Lane C.
const now = '2026-10-18T09:00:00.000Z';
const settings = () => ({
  standinMode: 'unacked' as const,
  triggerUnackedSeconds: 60,
  dailyCostCapUsd: 2,
  triageEnabled: true,
  transcribeEnabled: true,
  aiEnabled: true,
  globalEnabled: true,
  spentTodayUsd: 0.03,
});
const kb = () => ({
  id: '0192f3a0-0000-7000-8000-000000009001',
  kind: 'service' as const,
  title: 'Solar installation',
  body: 'Rooftop systems 3kW to 20kW.',
  language: 'en' as const,
  enabled: true,
  updatedAt: now,
});
const tpl = () => ({
  id: '0192f3a0-0000-7000-8000-000000009002',
  key: 'follow_up',
  locale: 'en' as const,
  body: 'Hi {{1}}, following up on your enquiry.',
  waTemplateName: null,
  waTemplateLang: null,
  updatedAt: now,
});

export const aiFixtures = {
  settingsGet: settings,
  settingsPut: settings,
  kbList: () => ({ items: [kb()] }),
  kbCreate: kb,
  kbUpdate: kb,
  kbDelete: () => ({ ok: true as const }),
  templatesList: () => ({ items: [tpl()] }),
  templatesCreate: tpl,
  templatesUpdate: tpl,
  templatesDelete: () => ({ ok: true as const }),
  transcribeRetry: () => ({ ok: true as const }),
} as const;
