import { describe, expect, it } from 'vitest';
import { FakeAIProvider } from './fake';
import { transcribeAudio } from './tasks/transcribe';
import { MemoryUsageStore } from './usage';

const audio = new Uint8Array([1, 2, 3]);
const base = { workspaceId: '0192f3a0-0000-7000-8000-000000000001', audio, mime: 'audio/ogg' };

describe('voice transcription guard rails', () => {
  it('[F8.1][Q15] AI_ENABLED=false: no call is made and the caller gets {disabled}', async () => {
    const provider = new FakeAIProvider();
    const r = await transcribeAudio({ ...base, deps: { enabled: false, provider } });
    expect(r).toEqual({ ok: false, error: 'disabled' });
    expect(provider.calls).toHaveLength(0);
  });

  it('[F8.1][I6.5] transcribes, logs usage, and respects the daily cap', async () => {
    const usage = new MemoryUsageStore();
    const ok = await transcribeAudio({
      ...base,
      deps: { enabled: true, provider: new FakeAIProvider(), usage, capMicros: 10 },
    });
    expect(ok.ok && ok.value).toBe('fake transcript');
    expect(usage.rows[0]?.task).toBe('transcription');
    usage.rows[0]!.costMicros = 50; // spend over the cap
    const over = await transcribeAudio({
      ...base,
      deps: { enabled: true, provider: new FakeAIProvider(), usage, capMicros: 10 },
    });
    expect(over).toEqual({ ok: false, error: 'budget' });
  });

  it('[F8.3] a provider failure is returned (not thrown) so the message becomes failed + Retry', async () => {
    const r = await transcribeAudio({
      ...base,
      deps: {
        enabled: true,
        provider: new FakeAIProvider({}, 'invalid_output'),
        usage: new MemoryUsageStore(),
      },
    });
    expect(r.ok).toBe(false);
  });
});
