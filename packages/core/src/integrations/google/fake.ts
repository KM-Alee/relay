// Fake Google Calendar for tests and the Judge Console (swapped in via the registry). Owner: Lane C (T-144).
import { ProviderError, type CalEvent, type CalendarProvider } from '../types';

export interface FakeGoogle extends CalendarProvider {
  events: Map<string, CalEvent & { htmlLink: string; cancelled: boolean }>;
  busy: Array<{ start: Date; end: Date }>;
  refreshes: number;
  revoked: string[];
  /** Make `refresh` throw (e.g. invalid_grant, I3.2). */
  refreshError: ProviderError | null;
  /** Make freeBusy throw. */
  freeBusyError: ProviderError | null;
}

export function createFakeGoogle(): FakeGoogle {
  const f: FakeGoogle = {
    events: new Map(),
    busy: [],
    refreshes: 0,
    revoked: [],
    refreshError: null,
    freeBusyError: null,
    authUrl: ({ state, redirectUri }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?fake=1&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    async exchangeCode({ code }) {
      if (code === 'bad') throw new ProviderError('auth', 'google_invalid_grant');
      return {
        accessToken: `ya29.fake-access-${code}`,
        refreshToken: `1//fake-refresh-${code}`,
        expiresAt: new Date(Date.now() + 3600_000),
        email: 'agent@example.com',
      };
    },
    async refresh() {
      f.refreshes += 1;
      if (f.refreshError) throw f.refreshError;
      return {
        accessToken: `ya29.fake-refreshed-${f.refreshes}`,
        expiresAt: new Date(Date.now() + 3600_000),
      };
    },
    async revoke(token) {
      f.revoked.push(token);
    },
    async freeBusy(_t, from, to) {
      if (f.freeBusyError) throw f.freeBusyError;
      return f.busy.filter((b) => b.start < to && b.end > from);
    },
    async createEvent(_t, e) {
      const htmlLink = `https://calendar.google.com/event?eid=${e.eventId}`;
      f.events.set(e.eventId, { ...e, htmlLink, cancelled: false }); // same id twice = same event (idempotent)
      return { providerEventId: e.eventId, htmlLink };
    },
    async updateEvent(_t, id, e) {
      const cur = f.events.get(id);
      if (!cur) throw new ProviderError('permanent', 'google_404');
      f.events.set(id, { ...cur, ...e });
      return { htmlLink: cur.htmlLink };
    },
    async cancelEvent(_t, id) {
      const cur = f.events.get(id);
      if (cur) cur.cancelled = true;
    },
  };
  return f;
}
