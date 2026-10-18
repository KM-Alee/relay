// messaging API contracts: conversations, messages, templates (docs/11-api.md; I1.3-I1.11). Owner: Lane C.
import { z } from 'zod';
import { endpoint } from './endpoint';

export const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed'] as const;
export const messageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

/** Plain failure reasons (I1.7); the UI maps `inbox.failure.<reason>`. */
export const FAILURE_REASONS = [
  'recipient_not_allowed',
  'window_closed',
  'token_expired',
  'undeliverable',
  'template_invalid',
  'rate_limited',
  'opted_out',
  'not_connected',
  'unknown',
] as const;

export const conversationDto = z.object({
  id: z.uuid(),
  contactId: z.uuid().nullable(),
  phone: z.string(),
  name: z.string().nullable(),
  assignedUserId: z.uuid().nullable(),
  lastMessageAt: z.iso.datetime({ offset: true }).nullable(),
  preview: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
  /** I1.10: open iff now < lastInboundAt + 24 h */
  windowOpen: z.boolean(),
  windowClosesAt: z.iso.datetime({ offset: true }).nullable(),
  optedOut: z.boolean(),
  optOutSuggested: z.boolean(),
  hasFailed: z.boolean(),
});
export type ConversationDto = z.infer<typeof conversationDto>;

export const messageMediaDto = z.object({
  id: z.uuid(),
  mime: z.string(),
  filename: z.string().nullable(),
  sizeBytes: z.number().int(),
  /** Authed proxy URL (never a blob URL). */
  url: z.string(),
});

export const messageDto = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  direction: z.enum(['in', 'out']),
  authorType: z.enum(['customer', 'user', 'ai', 'system']),
  authorUserId: z.uuid().nullable(),
  kind: z.enum(['text', 'template', 'audio', 'image', 'document', 'event']),
  body: z.string().nullable(),
  templateName: z.string().nullable(),
  status: messageStatusSchema,
  statusReason: z.string().nullable(),
  statusDetail: z.string().nullable(),
  media: messageMediaDto.nullable(),
  /** F8.1/F8.3: voice-note transcript (AI) and its state. */
  transcript: z.string().nullable().optional(),
  transcriptStatus: z.enum(['none', 'pending', 'done', 'failed']).optional(),
  summary: z.string().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type MessageDto = z.infer<typeof messageDto>;

export const templateDto = z.object({
  key: z.string(),
  name: z.string(),
  lang: z.string(),
  body: z.string(),
  paramCount: z.number().int().nonnegative(),
});
export type TemplateDto = z.infer<typeof templateDto>;

const idParams = z.object({ id: z.uuid() });

export const sendMessageInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().trim().min(1).max(4000),
    clientKey: z.string().max(64).optional(),
  }),
  z.object({
    kind: z.literal('template'),
    templateKey: z.string().min(1).max(100),
    params: z.array(z.string().max(500)).max(10).default([]),
    clientKey: z.string().max(64).optional(),
  }),
]);
export type SendMessageInput = z.infer<typeof sendMessageInput>;

export const messagingEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/api/v1/conversations',
    query: z.object({
      filter: z.enum(['all', 'unread', 'failed']).default('all'),
      before: z.iso.datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    response: z.object({
      conversations: z.array(conversationDto),
      nextBefore: z.iso.datetime({ offset: true }).nullable(),
    }),
  }),
  messages: endpoint({
    method: 'GET',
    path: '/api/v1/conversations/:id/messages',
    params: idParams,
    query: z.object({
      before: z.iso.datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    response: z.object({
      conversation: conversationDto,
      /** Oldest first. */
      messages: z.array(messageDto),
      nextBefore: z.iso.datetime({ offset: true }).nullable(),
    }),
  }),
  send: endpoint({
    method: 'POST',
    path: '/api/v1/conversations/:id/messages',
    params: idParams,
    body: sendMessageInput,
    response: messageDto,
  }),
  retry: endpoint({
    method: 'POST',
    path: '/api/v1/conversations/:id/messages/:messageId/retry',
    params: z.object({ id: z.uuid(), messageId: z.uuid() }),
    response: messageDto,
  }),
  markRead: endpoint({
    method: 'POST',
    path: '/api/v1/conversations/:id/read',
    params: idParams,
    response: z.object({ ok: z.literal(true) }),
  }),
  optOut: endpoint({
    method: 'POST',
    path: '/api/v1/conversations/:id/opt-out',
    params: idParams,
    body: z.object({ optedOut: z.boolean() }),
    response: conversationDto,
  }),
  templates: endpoint({
    method: 'GET',
    path: '/api/v1/message-templates',
    response: z.object({ templates: z.array(templateDto) }),
  }),
} as const;
