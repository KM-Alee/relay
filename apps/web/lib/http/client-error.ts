// Client-side error handling (Q10): turn any failed API call into a code + i18n key the UI renders
// with next-intl: `t(err.i18nKey, err.details)`. No UI here; Lane D's toasts/inline errors use it.
import {
  ERROR_CATALOGUE,
  errorEnvelopeSchema,
  errorI18nKey,
  isErrorCode,
  type ErrorCode,
} from '@relay/contracts/errors';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly i18nKey: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, status: number, details?: Record<string, unknown>) {
    super(ERROR_CATALOGUE[code].message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.i18nKey = errorI18nKey(code);
    this.details = details;
  }
}

/** Read a non-2xx Response into an ApiError (tolerates non-JSON bodies, e.g. a proxy's HTML 502). */
export async function readApiError(res: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  const env = errorEnvelopeSchema.safeParse(parsed);
  if (env.success && isErrorCode(env.data.error.code)) {
    return new ApiError(env.data.error.code, res.status, env.data.error.details);
  }
  const byStatus: Partial<Record<number, ErrorCode>> = {
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMITED',
    503: 'PROVIDER_UNAVAILABLE',
  };
  return new ApiError(byStatus[res.status] ?? 'INTERNAL', res.status);
}

/** Anything thrown by fetch/api-client → ApiError (network failures → NETWORK_ERROR). */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError('NETWORK_ERROR', 0);
}

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/** Localized message for an error, e.g. in a toast: `localizeError(err, t)`. */
export function localizeError(err: unknown, t: Translate): string {
  const e = toApiError(err);
  const values: Record<string, string | number | Date> = {};
  for (const [k, v] of Object.entries(e.details ?? {})) {
    if (typeof v === 'string' || typeof v === 'number' || v instanceof Date) values[k] = v;
  }
  return t(e.i18nKey, values);
}
