import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors';
import { signQStashRequest } from '../integrations/qstash/test-signing';
import { createQStashVerifier } from '../integrations/qstash/verify';
import type { TickResult } from './run-due-work';
import { authorizeTick, handleTick, MAX_TICK_BODY_BYTES, type TickAuthDeps } from './tick';

const KEY = 'current_key_for_tests';
const URL_ = 'https://relay.example.com/api/internal/tick';
const deps: TickAuthDeps = {
  cronSecret: 's3cret-cron-token',
  verifier: createQStashVerifier({ currentSigningKey: KEY, nextSigningKey: 'next_key_for_tests' }),
  tickUrl: URL_,
};
const signed = (body: string) => ({
  authorization: null,
  signature: signQStashRequest({ key: KEY, url: URL_, body }),
  rawBody: body,
});

describe('[Q5] /api/internal/tick authorization', () => {
  it.each([
    ['Bearer CRON_SECRET → manual', { authorization: 'Bearer s3cret-cron-token' }, 'manual'],
    ['bearer is case-insensitive', { authorization: 'bearer s3cret-cron-token' }, 'manual'],
    ['wrong bearer → 401', { authorization: 'Bearer nope' }, null],
    ['bearer prefix of the secret → 401', { authorization: 'Bearer s3cret' }, null],
    ['empty bearer → 401', { authorization: 'Bearer ' }, null],
    ['no credentials → 401', {}, null],
    ['a bad signature → 401', { signature: 'x.y.z' }, null],
  ] as const)('[Q5] %s', async (_n, req, expected) => {
    const r = await authorizeTick({ authorization: null, signature: null, rawBody: '', ...req }, deps);
    expect(r).toBe(expected);
  });

  it('[Q5] a valid QStash wake-up runs as "qstash"; the signed backstop body runs as "cron"', async () => {
    expect(await authorizeTick(signed('{"trigger":"qstash","at":"2026-10-18T10:00:00Z"}'), deps)).toBe(
      'qstash',
    );
    expect(await authorizeTick(signed('{"trigger":"cron"}'), deps)).toBe('cron');
    expect(await authorizeTick(signed(''), deps)).toBe('qstash');
  });

  it('[Q5] a bearer token is useless when CRON_SECRET is not configured', async () => {
    const r = await authorizeTick(
      { authorization: 'Bearer anything', signature: null, rawBody: '' },
      { ...deps, cronSecret: undefined },
    );
    expect(r).toBeNull();
  });

  it('[Q5] a signature is refused when signing keys are not configured', async () => {
    const r = await authorizeTick(signed('{"trigger":"cron"}'), { ...deps, verifier: null, tickUrl: null });
    expect(r).toBeNull();
  });

  it('[Q5] oversized bodies are refused before verification', async () => {
    const big = 'x'.repeat(MAX_TICK_BODY_BYTES + 1);
    expect(await authorizeTick(signed(big), deps)).toBeNull();
  });

  it('[Q5] handleTick: 401 UNAUTHENTICATED without credentials, and never runs due work', async () => {
    const run = vi.fn();
    const err = await handleTick(
      { authorization: null, signature: null, rawBody: '' },
      { auth: deps, run },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'UNAUTHENTICATED', httpStatus: 401 });
    expect(run).not.toHaveBeenCalled();
  });

  it('[Q5] handleTick runs due work with the authorized trigger', async () => {
    const run = vi.fn(async () => ({ runId: 'r1' }) as TickResult);
    await handleTick(signed('{"trigger":"cron"}'), { auth: deps, run });
    expect(run).toHaveBeenCalledWith({ trigger: 'cron' });
  });
});
