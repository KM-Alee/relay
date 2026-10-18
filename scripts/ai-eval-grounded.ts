// Grounded-answer eval against the SEEDED Sunrise Solar knowledge base (T-208, F6.5). Real OpenAI.
// Run via `pnpm ai:eval` (the main script imports and runs this at the end) or alone:
//   pnpm tsx --env-file-if-exists=apps/web/.env.local scripts/ai-eval-grounded.ts
import { generateStandInReply, type AiDeps, type KbEntry, type Turn } from '../packages/core/src/ai/index';
import { SEED_KB } from '../packages/db/seed/ai-data';

const SEEDED: KbEntry[] = SEED_KB.sunrise.map((e, i) => ({ id: `kb${i + 1}`, ...e }));

const CASES: { q: string; mustHave?: RegExp; mustNot?: RegExp; handoffOk?: boolean }[] = [
  { q: 'Assalam o alaikum, 5kW solar system ka kitna rate hai?', mustHave: /760[, ]?000/ },
  { q: 'Do you offer instalments or financing?', mustHave: /instal|bank|36|financ/i },
  { q: 'Kya aap Islamabad mein bhi installation karte hain?', mustHave: /islamabad/i },
  { q: 'How long is the panel warranty?', mustHave: /12|25/ },
  {
    q: 'Do you install wind turbines and what do they cost?',
    mustNot: /Rs\s?\d|PKR|\$\s?\d/i,
    handoffOk: true,
  },
];

/** Returns the number of failed checks. */
export async function runGroundedEval(workspaceId: string, deps: AiDeps): Promise<number> {
  let failures = 0;
  const check = (ok: boolean, msg: string) => {
    if (!ok) failures++;
    console.log(`   ${ok ? 'PASS' : 'FAIL'} ${msg}`);
  };
  console.log('\n=== Grounded answers with the SEEDED Sunrise Solar knowledge base (T-208, F6.5)');
  for (const g of CASES) {
    const history: Turn[] = [{ role: 'customer', text: g.q }];
    const r = await generateStandInReply({
      workspaceId,
      workspaceName: 'Sunrise Solar',
      isFirstAiMessage: false,
      status: { ownerFirstName: null, notified: true },
      knowledge: SEEDED,
      contact: { name: 'Ali' },
      collectedFields: {},
      openQuestions: [],
      history,
      deps,
    });
    console.log(`   Q: ${g.q}`);
    console.log(`   A[${r.kind}] kb=[${r.answeredFromKb.join(',')}]: ${r.text.replace(/\n+/g, ' | ')}`);
    if (!deps.enabled) continue;
    if (g.mustHave) check(g.mustHave.test(r.text), `grounded: reply matches ${g.mustHave}`);
    if (g.mustNot) check(!g.mustNot.test(r.text), 'did not invent a price');
    if (!g.handoffOk) check(r.kind === 'ai', 'answered by the model from the KB');
  }
  return failures;
}
