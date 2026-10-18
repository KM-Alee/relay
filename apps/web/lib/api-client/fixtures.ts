// Fixture mode (13 §4). With NEXT_PUBLIC_API_FIXTURES=1 (never in production), domains flagged
// `true` below return fixture builders' output instead of calling the network.
// When a domain's real backend merges, its lane flips the flag to `false` (one-line diff).
export type ApiDomain =
  | 'auth'
  | 'users'
  | 'crm'
  | 'audit'
  | 'leads'
  | 'teams'
  | 'notifications'
  | 'messaging'
  | 'payments'
  | 'calendar'
  | 'integrations'
  | 'judge'
  | 'ai'
  | 'dashboard'
  | 'realtime';

export const FIXTURE_DOMAINS: Record<ApiDomain, boolean> = {
  auth: true, // B
  users: true, // B
  crm: false, // B (T-110…T-118: real routes merged)
  audit: true, // B
  leads: true, // A
  teams: true, // A
  notifications: true, // A
  messaging: true, // C
  payments: false, // C (T-143: real routes merged)
  calendar: false, // C (T-144: real routes merged)
  integrations: false, // C (T-140: real routes merged)
  judge: false, // B (T-209)
  ai: true, // C
  dashboard: true, // D
  realtime: true, // C
};

export function fixturesEnabled(domain: ApiDomain): boolean {
  // Literal `process.env.NEXT_PUBLIC_*` access so Next inlines it into the client bundle.
  const on = process.env.NEXT_PUBLIC_API_FIXTURES === '1' && process.env.NODE_ENV !== 'production';
  return on && FIXTURE_DOMAINS[domain];
}
