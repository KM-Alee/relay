// Fixture builders for messaging contracts (13 §4). Owner: Lane C. Pattern: ./users.ts.
import type { ConversationDto, MessageDto, TemplateDto } from '../api/messaging';

const NOW = '2026-10-18T09:00:00.000Z';
const conv = (over: Partial<ConversationDto> = {}): ConversationDto => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  contactId: null,
  phone: '+923001234567',
  name: 'Bilal Ahmed',
  assignedUserId: null,
  lastMessageAt: NOW,
  preview: 'Salam, price kya hai?',
  unreadCount: 1,
  windowOpen: true,
  windowClosesAt: '2026-10-19T09:00:00.000Z',
  optedOut: false,
  optOutSuggested: false,
  hasFailed: false,
  ...over,
});
const msg = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  conversationId: conv().id,
  direction: 'in',
  authorType: 'customer',
  authorUserId: null,
  kind: 'text',
  body: 'Salam, price kya hai?',
  templateName: null,
  status: 'delivered',
  statusReason: null,
  statusDetail: null,
  media: null,
  createdAt: NOW,
  ...over,
});
const tpl: TemplateDto = {
  key: 'hello_world',
  name: 'hello_world',
  lang: 'en_US',
  body: 'Hello World',
  paramCount: 0,
};

/** One entry per endpoint in messagingEndpoints, used by the api-client in fixture mode. */
export const messagingFixtures = {
  list: () => ({
    conversations: [
      conv(),
      conv({
        id: '00000000-0000-4000-8000-0000000000c2',
        name: 'Sara',
        unreadCount: 0,
        windowOpen: false,
        windowClosesAt: null,
      }),
    ],
    nextBefore: null,
  }),
  messages: () => ({
    conversation: conv(),
    messages: [
      msg(),
      msg({
        id: '00000000-0000-4000-8000-0000000000d2',
        direction: 'out',
        authorType: 'user',
        body: 'Walaikum salam!',
        status: 'read',
      }),
      msg({
        id: '00000000-0000-4000-8000-0000000000d3',
        direction: 'out',
        authorType: 'user',
        body: 'Quote bhej raha hun',
        status: 'failed',
        statusReason: 'recipient_not_allowed',
      }),
    ],
    nextBefore: null,
  }),
  send: () => msg({ direction: 'out', authorType: 'user', status: 'queued' }),
  retry: () => msg({ direction: 'out', authorType: 'user', status: 'queued' }),
  markRead: () => ({ ok: true as const }),
  optOut: () => conv({ optedOut: true }),
  templates: () => ({ templates: [tpl] }),
} as const;
