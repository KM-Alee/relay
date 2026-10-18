// Typed application errors (docs/01-architecture.md §5 step 6, docs/10-conventions.md §1).
// Services throw AppError; route() maps it to the JSON envelope. Never throw raw strings, never
// leak stack traces or SQL errors to clients.
import { ERROR_CATALOGUE, type ErrorCode, type ErrorEnvelope } from '@relay/contracts/errors';
import { z } from 'zod';

export interface AppErrorOptions {
  /** Interpolation params for the i18n message + machine-readable context. Never secrets. */
  details?: Record<string, unknown>;
  httpStatus?: number;
  i18nKey?: string;
  /** Internal message for logs; the client gets the catalogue's generic message. */
  message?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly i18nKey: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, opts: AppErrorOptions = {}) {
    super(opts.message ?? ERROR_CATALOGUE[code].message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = opts.httpStatus ?? ERROR_CATALOGUE[code].status;
    this.i18nKey = opts.i18nKey ?? ERROR_CATALOGUE[code].i18nKey;
    this.details = opts.details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Out-of-scope or other-workspace ids → 404, never 403 (F1.6, 11 §1). */
export const notFound = (details?: Record<string, unknown>) => new AppError('NOT_FOUND', { details });
export const forbidden = (details?: Record<string, unknown>) => new AppError('FORBIDDEN', { details });
export const staleVersion = (current?: unknown) =>
  new AppError('STALE_VERSION', { details: current === undefined ? undefined : { current } });

/** Zod issues → VALIDATION_FAILED details: paths + codes only (no echo of the submitted values). */
export function validationError(err: z.ZodError, where: 'body' | 'query' | 'params'): AppError {
  return new AppError('VALIDATION_FAILED', {
    details: {
      in: where,
      issues: err.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    },
  });
}

/** Map anything thrown to `{ status, body }`. Unknown errors become a generic 500. */
export function toErrorResponse(err: unknown): { status: number; body: ErrorEnvelope; appError: AppError } {
  const appError = isAppError(err)
    ? err
    : err instanceof z.ZodError
      ? validationError(err, 'body')
      : new AppError('INTERNAL', { cause: err });
  const generic = ERROR_CATALOGUE[appError.code].message;
  return {
    status: appError.httpStatus,
    appError,
    body: {
      error: {
        code: appError.code,
        message: generic,
        i18nKey: appError.i18nKey,
        ...(appError.details ? { details: appError.details } : {}),
      },
    },
  };
}
