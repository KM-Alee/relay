import { onboardingProposal } from '@relay/contracts/api/crm-extras';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_TEMPLATES, matchTemplate } from './crm-onboarding-templates';
import { normalizeProposal } from './crm-onboarding';

describe('onboarding proposals', () => {
  it('[F9.3] every built-in template is a valid proposal with Urdu labels and a won + lost stage', () => {
    for (const t of ONBOARDING_TEMPLATES) {
      expect(onboardingProposal.safeParse(t.proposal).success).toBe(true);
      for (const p of t.proposal.pipelines) {
        expect(p.stages.some((s) => s.kind === 'won')).toBe(true);
        expect(p.stages.some((s) => s.kind === 'lost')).toBe(true);
      }
      for (const f of t.proposal.fields) expect(f.label.ur).toMatch(/[؀-ۿ]/);
    }
  });

  it('[F9.3] a description falls back to the nearest template when AI is off', () => {
    expect(matchTemplate('We are a dental clinic in Karachi with 3 dentists')).toBe('clinic');
    expect(matchTemplate('solar installer in Lahore, 8 sales reps')).toBe('solar');
    expect(matchTemplate('property dealer, plots in DHA')).toBe('real_estate');
    expect(matchTemplate('we sell shoes')).toBeNull();
  });

  it('[Q3] model output is coerced into the strict contract (bad keys, missing won/lost, unknown required keys)', () => {
    const p = normalizeProposal({
      businessSummary: ' Dental clinic ',
      pipelines: [
        {
          name: 'Patients',
          stages: [
            { name: 'New', kind: 'open', rotDays: 0, requiredFieldKeys: ['Treatment Type', 'nope'] },
            { name: 'Booked', kind: 'open', rotDays: 3.4, requiredFieldKeys: ['Treatment Type', 'nope'] },
          ],
        },
      ],
      fields: [
        {
          entity: 'contact',
          key: 'Treatment Type!',
          label: { en: 'Treatment', ur: '' },
          type: 'dropdown',
          options: [{ value: 'only one', label: { en: 'One', ur: 'ایک' } }],
        },
      ],
      tags: ['VIP', 'vip', ' '],
    });
    expect(p).not.toBeNull();
    const stages = p!.pipelines[0]!.stages;
    expect(stages.map((s) => s.kind)).toEqual(['open', 'open', 'won', 'lost']);
    expect(stages[0]!.requiredFieldKeys).toEqual([]); // never on the first stage
    expect(stages[1]!.requiredFieldKeys).toEqual(['treatment_type']);
    expect(stages[1]!.rotDays).toBe(3);
    expect(p!.fields[0]).toMatchObject({ key: 'treatment_type', type: 'text', options: [] }); // 1 option -> text
    expect(p!.fields[0]!.label.ur).toBe('Treatment');
    expect(p!.tags).toEqual(['VIP']);
  });
});
