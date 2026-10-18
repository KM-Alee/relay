// i18n namespaces (13 §3): one JSON file per namespace per locale in apps/web/messages/<locale>/.
// Each namespace belongs to ONE lane (13 §2). Adding a namespace = new en+ur files + one line here.
export const NAMESPACES = [
  'common', // D: nav labels, shared UI, ComingSoon
  'overview', // D
  'errors', // W0/D: one key per error code (contracts/errors.ts)
  'leads', // A
  'automations', // A
  'auth', // B
  'crm', // B
  'team', // B
  'settings', // B
  'inbox', // C
  'integrations', // C
  'ai', // C
  'payments', // C (T-143)
  'appointments', // C (T-144)
  'ui', // D3 (T-228): motion/Lottie kit + kitchen-sink motion section
] as const;
export type Namespace = (typeof NAMESPACES)[number];
