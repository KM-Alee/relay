// Query keys (docs/07 §2). The TOPIC is always the first segment: realtime hints invalidate by topic.
// Topics: leads, recovery, radar, conversations, messages, contacts, opportunities, payments, appointments,
// dashboard, notifications, integrations, team. Add keys for your domain here (additive edits only).
export const qk = {
  me: () => ['me'] as const,
  leads: {
    list: (filters?: unknown) => ['leads', 'list', filters ?? {}] as const,
    detail: (id: string) => ['leads', 'detail', id] as const,
  },
  recovery: () => ['recovery'] as const,
  radar: () => ['radar'] as const,
  conversations: {
    list: (filters?: unknown) => ['conversations', 'list', filters ?? {}] as const,
    detail: (id: string) => ['conversations', 'detail', id] as const,
    messages: (id: string) => ['messages', id] as const,
  },
  contacts: {
    list: (filters?: unknown) => ['contacts', 'list', filters ?? {}] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
  },
  opportunities: {
    list: (filters?: unknown) => ['opportunities', 'list', filters ?? {}] as const,
    detail: (id: string) => ['opportunities', 'detail', id] as const,
  },
  dashboard: (figureKey?: string) => ['dashboard', figureKey ?? 'all'] as const,
  notifications: () => ['notifications'] as const,
  integrations: () => ['integrations'] as const,
  team: {
    availability: (userId = 'me') => ['team', 'availability', userId] as const,
    members: () => ['team', 'members'] as const,
    invites: () => ['team', 'invites'] as const,
    roles: () => ['team', 'roles'] as const,
    levels: () => ['team', 'levels'] as const,
    overrides: (userId: string) => ['team', 'overrides', userId] as const,
    sessions: () => ['team', 'sessions'] as const,
  },
  audit: (filters?: unknown) => ['audit', filters ?? {}] as const,
} as const;
