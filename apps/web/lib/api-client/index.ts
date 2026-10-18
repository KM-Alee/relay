// Typed API client (13 §4): `api.<domain>.<op>()`. Owner: Lane D; each domain file belongs to its lane.
// Shared file: ONE import + ONE entry per domain (already complete for 13 §2 domains).
import { ai } from './domains/ai';
import { audit } from './domains/audit';
import { automations } from './domains/automations';
import { auth } from './domains/auth';
import { calendar } from './domains/calendar';
import { crm } from './domains/crm';
import { dashboard } from './domains/dashboard';
import { integrations } from './domains/integrations';
import { leads } from './domains/leads';
import { messaging } from './domains/messaging';
import { notifications } from './domains/notifications';
import { payments } from './domains/payments';
import { realtime } from './domains/realtime';
import { teams } from './domains/teams';
import { users } from './domains/users';

export const api = {
  ai,
  audit,
  automations,
  auth,
  calendar,
  crm,
  dashboard,
  integrations,
  leads,
  messaging,
  notifications,
  payments,
  realtime,
  teams,
  users,
};

export { ApiError, localizeError, readApiError } from '@/lib/http/client-error';
export { call, type CallOptions } from './http';
export { FIXTURE_DOMAINS, fixturesEnabled, type ApiDomain } from './fixtures';
