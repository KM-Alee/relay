// Adapter interfaces shared by all providers (docs/04-integrations.md §1). Owner: Lane C.
// Adapters are thin translators: no DB access, no business rules. They get DECRYPTED credentials from
// the caller and throw ProviderError; the job runner maps `kind` to retry / fail / needs_reconnect.

export type Creds = Record<string, string>;
export type RawRequest = { method: string; url: URL; headers: Headers; rawBody: string };

export type ProviderErrorKind = 'temporary' | 'permanent' | 'auth';

/** `kind` is read structurally by the outbox runner (decideFailure): keep the property names. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    readonly kind: ProviderErrorKind,
    readonly code: string,
    message?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message ?? code);
  }
}

export interface SlackCommand {
  command: string;
  text: string;
  teamId: string;
  userId: string;
  responseUrl: string;
  triggerId: string;
  apiAppId: string | null;
}

export interface SlackInteraction {
  type: string;
  teamId: string | null;
  userId: string;
  triggerId: string;
  responseUrl: string | null;
  apiAppId: string | null;
  channelId: string | null;
  messageTs: string | null;
  /** First action only (we only ever render one button per alert). */
  action: { actionId: string; value: string; actionTs: string } | null;
}

export type SlackMessage = { blocks: unknown[]; text: string };

export interface Notifier {
  verifyRequest(req: RawRequest, creds: Creds, now?: Date): { ok: true } | { ok: false; reason: string };
  parseCommand(req: RawRequest): SlackCommand;
  parseInteraction(req: RawRequest): SlackInteraction;
  /** conversations.open + chat.postMessage → the DM channel id and message ts. */
  sendAlert(slackUserId: string, msg: SlackMessage, creds: Creds): Promise<{ channel: string; ts: string }>;
  updateAlert(channel: string, ts: string, msg: SlackMessage, creds: Creds): Promise<void>;
  /** Post to a response_url (ephemeral by default). */
  respond(responseUrl: string, text: string): Promise<void>;
  /** auth.test: connectivity probe. */
  authTest(creds: Creds): Promise<{ teamId: string; botUserId: string }>;
}
