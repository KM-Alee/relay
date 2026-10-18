// Judge Console scenario registry (F10.1, docs/08-testing.md §6). Owner: Lane B (T-209).
//
// Adding a scenario (3 steps): 1) create `scenarios/<id>.ts` exporting a JudgeScenario (see types.ts);
// 2) add it to SCENARIOS below; 3) add `judge.scenarios.<id>.{title,description,expected}` to
// apps/web/messages/{en,ur}/judge.json. Lane A fills the three `lead-*` placeholders by replacing their `run`.
import type { JudgeScenario } from './types';
import { auditTamper } from './scenarios/audit-tamper';
import { crossWorkspace } from './scenarios/cross-workspace';
import { dataSurvivesRestart } from './scenarios/data-survives-restart';
import { leadAbsenceReassign } from './scenarios/lead-absence-reassign';
import { leadFallbackCustody } from './scenarios/lead-fallback-custody';
import { leadTimersOnce } from './scenarios/lead-timers-once';
import { metaDuplicate } from './scenarios/meta-duplicate';
import { metaForged } from './scenarios/meta-forged';
import { providerDown } from './scenarios/provider-down';
import { slackForged } from './scenarios/slack-forged';
import { stripeDuplicate } from './scenarios/stripe-duplicate';
import { stripeForged } from './scenarios/stripe-forged';
import { unauthorized } from './scenarios/unauthorized';
import { valueMasking } from './scenarios/value-masking';

export const SCENARIOS: readonly JudgeScenario[] = [
  crossWorkspace,
  valueMasking,
  unauthorized,
  leadFallbackCustody,
  leadTimersOnce,
  leadAbsenceReassign,
  auditTamper,
  metaForged,
  metaDuplicate,
  stripeForged,
  stripeDuplicate,
  slackForged,
  providerDown,
  dataSurvivesRestart,
];

export const findScenario = (id: string): JudgeScenario | undefined => SCENARIOS.find((s) => s.id === id);
