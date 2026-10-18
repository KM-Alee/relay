import { describe, expect, it } from 'vitest';
import {
  FakeAIProvider,
  MemoryUsageStore,
  checkReply,
  detect,
  fallbackReply,
  generateHandoffBrief,
  generateStandInReply,
  triageMessage,
} from './index';

const WS = '00000000-0000-4000-8000-000000000001';
const KB = [
  { id: 'k1', kind: 'service', title: 'Solar', body: 'Rooftop solar 3kW to 20kW. Quote after survey.' },
];
const base = {
  workspaceId: WS,
  workspaceName: 'Sunrise Solar',
  isFirstAiMessage: true,
  status: { ownerFirstName: 'Hamza', notified: true },
  knowledge: KB,
  contact: {},
  collectedFields: {},
  openQuestions: [{ key: 'city', label: 'City' }],
  history: [{ role: 'customer' as const, text: 'mujhe solar lagwana hai, kitne paise lagenge?' }],
};
const reply = (r: string) => ({
  reply: r,
  answeredFromKb: ['k1'],
  collected: [],
  askedQuestionKey: 'city',
  confidence: 0.9,
  handoff: { needed: false, reason: null },
});
const ctx = { lang: 'en' as const, priceKnowledge: [], allKnowledge: [], allowedNames: [] };
const mk = (provider: FakeAIProvider, extra = {}) => ({
  enabled: true,
  provider,
  usage: new MemoryUsageStore(),
  ...extra,
});

describe('AI layer', () => {
  it('[F7.5] detects Urdu script, Roman Urdu and English', () => {
    expect(detect('مجھے اپوائنٹمنٹ چاہیے')).toBe('ur');
    expect(detect('mujhe solar lagwana hai')).toBe('ur-Latn');
    expect(detect('How much does a 5kW system cost?')).toBe('en');
  });

  it('[F6.8] guard blocks prices, discounts, bookings, payment links, ETAs', () => {
    for (const bad of [
      'It costs Rs 5,000',
      'We offer a 10% discount',
      'Your booking is confirmed',
      'Here is the payment link',
      'We will call within 5 minutes',
    ])
      expect(checkReply(bad, ctx).violations.length, bad).toBeGreaterThan(0);
    expect(checkReply('A team member will share the quote after the survey.', ctx).violations).toEqual([]);
  });

  it('[F6.8] a model reply with a discount never reaches the customer', async () => {
    const provider = new FakeAIProvider({ standin_reply: reply('Sure, I can give you a 20% discount!') });
    const r = await generateStandInReply({ ...base, deps: mk(provider) });
    expect(r.kind).toBe('holding');
    expect(r.text).not.toMatch(/discount/i);
    expect(r.handoff.needed).toBe(true);
  });

  it('[F6.3] [F7.5] first AI message is prefixed with disclosure in the customer language', async () => {
    const provider = new FakeAIProvider({ standin_reply: reply('Ji zaroor! Aap kis shehar mein hain?') });
    const r = await generateStandInReply({ ...base, deps: mk(provider) });
    expect(r.kind).toBe('ai');
    expect(r.language).toBe('ur-Latn');
    expect(r.text).toMatch(/^Main Sunrise Solar ka assistant/);
  });

  it('[F6.9] asking for a human hands off without calling the model', async () => {
    const provider = new FakeAIProvider({});
    const r = await generateStandInReply({
      ...base,
      history: [{ role: 'customer', text: 'I want to talk to a real person' }],
      deps: mk(provider),
    });
    expect(r.handoff).toEqual({ needed: true, reason: 'asked_human' });
    expect(provider.calls).toEqual([]);
  });

  it('[Q15] [F6.11] AI_ENABLED=false: fallbacks, heuristics and baseline brief, no provider call', async () => {
    const provider = new FakeAIProvider({});
    const deps = mk(provider, { enabled: false });
    const r = await generateStandInReply({ ...base, isFirstAiMessage: false, deps });
    expect(r.kind).toBe('fallback');
    expect(r.text).toBe(fallbackReply('ur-Latn'));
    const t = await triageMessage({ workspaceId: WS, messages: base.history, deps });
    expect(t.source).toBe('heuristic');
    expect(t.language).toBe('ur-Latn');
    const b = await generateHandoffBrief({
      workspaceId: WS,
      fields: { City: 'Lahore' },
      history: base.history,
      deps,
    });
    expect(b.source).toBe('baseline');
    expect(provider.calls).toEqual([]);
  });

  it('[I6.4] over the daily cap degrades to the fallback', async () => {
    const usage = new MemoryUsageStore();
    await usage.record(WS, {
      task: 'x',
      model: 'm',
      promptVersion: null,
      status: 'ok',
      inTokens: 0,
      outTokens: 0,
      costMicros: 10,
      latencyMs: 0,
    });
    const provider = new FakeAIProvider({ standin_reply: reply('hi') });
    const r = await generateStandInReply({ ...base, deps: mk(provider, { usage, capMicros: 10 }) });
    expect(r.kind).toBe('fallback');
    expect(r.fallbackReason).toBe('budget');
    expect(provider.calls).toEqual([]);
  });
});
