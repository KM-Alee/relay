import { createQStashVerifier } from '@relay/core/integrations/qstash';
import { signQStashRequest } from '@relay/core/integrations/qstash/test-signing';
import type { TickResult } from '@relay/core/jobs/run-due-work';
import { describe, expect, it, vi } from 'vitest';
import { createTickHandler } from './tick-handler';

const URL_ = 'https://relay.example.com/api/internal/tick';
const KEY = 'k_current';
const auth = {
  cronSecret: 'cron-secret',
  verifier: createQStashVerifier({ currentSigningKey: KEY, nextSigningKey: 'k_next' }),
  tickUrl: URL_,
};
const result = { runId: 'run-1', trigger: 'manual', outboxProcessed: 0 } as unknown as TickResult;

describe('POST /api/internal/tick', () => {
  it('[Q5] 401 envelope without credentials; due work is not run', async () => {
    const run = vi.fn();
    const res = await createTickHandler({ auth, run })(new Request(URL_, { method: 'POST' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(run).not.toHaveBeenCalled();
  });

  it('[Q5] Bearer CRON_SECRET runs a manual tick and returns the run summary', async () => {
    const run = vi.fn(async () => result);
    const res = await createTickHandler({ auth, run })(
      new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer cron-secret' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: 'run-1' });
    expect(run).toHaveBeenCalledWith({ trigger: 'manual' });
  });

  it('[Q5] verifies the signature over the RAW body bytes (backstop → cron)', async () => {
    const run = vi.fn(async () => result);
    const raw = '{ "trigger" : "cron" }'; // odd spacing: a re-serialized body would not match
    const res = await createTickHandler({ auth, run })(
      new Request(URL_, {
        method: 'POST',
        headers: { 'upstash-signature': signQStashRequest({ key: KEY, url: URL_, body: raw }) },
        body: raw,
      }),
    );
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ trigger: 'cron' });
  });

  it('[Q5] a forged signature is 401', async () => {
    const run = vi.fn();
    const raw = '{"trigger":"cron"}';
    const res = await createTickHandler({ auth, run })(
      new Request(URL_, {
        method: 'POST',
        headers: { 'upstash-signature': signQStashRequest({ key: 'attacker', url: URL_, body: raw }) },
        body: raw,
      }),
    );
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('[Q5] a failing tick is a generic 500 envelope (QStash retries), no internals leaked', async () => {
    const run = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
    });
    const res = await createTickHandler({ auth, run })(
      new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer cron-secret' } }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});
