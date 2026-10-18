// API error codes + envelope (docs/11-api.md §1, Q10). Shared by server (AppError) and client
// (localized rendering). SHARED FILE: lanes add codes additively, never rename existing ones.
// Every code needs an `errors.<i18nKey>` entry in apps/web/messages/{en,ur}/errors.json (a test checks).
import { z } from 'zod';

export const ERROR_CATALOGUE = {
  VALIDATION_FAILED: { status: 400, i18nKey: 'errors.validationFailed', message: 'The request is invalid.' },
  UNAUTHENTICATED: { status: 401, i18nKey: 'errors.unauthenticated', message: 'Sign in to continue.' },
  FORBIDDEN: { status: 403, i18nKey: 'errors.forbidden', message: 'You do not have permission to do this.' },
  CSRF_FAILED: { status: 403, i18nKey: 'errors.csrfFailed', message: 'The request could not be verified.' },
  // Also used for other workspaces' / out-of-scope ids: never reveal existence (F1.6).
  NOT_FOUND: { status: 404, i18nKey: 'errors.notFound', message: 'Not found.' },
  CONFLICT: {
    status: 409,
    i18nKey: 'errors.conflict',
    message: 'The request conflicts with the current state.',
  },
  STALE_VERSION: {
    status: 409,
    i18nKey: 'errors.staleVersion',
    message: 'This record was changed by someone else.',
  },
  LEAD_STATE_CHANGED: {
    status: 409,
    i18nKey: 'errors.leadStateChanged',
    message: 'The lead changed in the meantime.',
  },
  ALREADY_CLAIMED: {
    status: 409,
    i18nKey: 'errors.alreadyClaimed',
    message: 'The lead was already claimed.',
  },
  INVITE_INVALID: {
    status: 410,
    i18nKey: 'errors.inviteInvalid',
    message: 'This invite is invalid or has expired.',
  },
  PAYLOAD_TOO_LARGE: { status: 413, i18nKey: 'errors.payloadTooLarge', message: 'The request is too large.' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    i18nKey: 'errors.unsupportedMediaType',
    message: 'Unsupported content type.',
  },
  REQUIRED_FIELDS_MISSING: {
    status: 422,
    i18nKey: 'errors.requiredFieldsMissing',
    message: 'Required fields are missing.',
  },
  BUSINESS_RULE_VIOLATION: {
    status: 422,
    i18nKey: 'errors.businessRuleViolation',
    message: 'This action is not allowed right now.',
  },
  RATE_LIMITED: {
    status: 429,
    i18nKey: 'errors.rateLimited',
    message: 'Too many attempts. Try again later.',
  },
  INTERNAL: { status: 500, i18nKey: 'errors.internal', message: 'Something went wrong.' },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    i18nKey: 'errors.providerUnavailable',
    message: 'An external service is unavailable.',
  },
  // Client-only: fetch failed before any HTTP response (offline, DNS, CORS).
  NETWORK_ERROR: { status: 0, i18nKey: 'errors.networkError', message: 'Network error.' },
} as const satisfies Record<string, { status: number; i18nKey: `errors.${string}`; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;
export const ERROR_CODES = Object.keys(ERROR_CATALOGUE) as ErrorCode[];

export const errorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

/** Wire format of every non-2xx JSON response: `{ error: { code, message, i18nKey, details? } }`. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    i18nKey: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(ERROR_CATALOGUE, code);
}

/** i18n key for a code; unknown codes (newer server, older client) fall back to INTERNAL. */
export function errorI18nKey(code: string): string {
  return isErrorCode(code) ? ERROR_CATALOGUE[code].i18nKey : ERROR_CATALOGUE.INTERNAL.i18nKey;
}
