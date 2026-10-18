// Built-in onboarding templates (T-218, F9.3): the no-AI fallback. Real estate, Solar, Clinic. Labels exist in
// English and Urdu (custom-field labels are localized; pipeline/stage/tag names are workspace text).
import type { OnboardingProposal, OnboardingTemplateDto } from '@relay/contracts/api/crm-extras';

type TemplateId = OnboardingTemplateDto['id'];

const opt = (value: string, en: string, ur: string) => ({ value, label: { en, ur } });
const open = (name: string, rotDays: number | null, requiredFieldKeys: string[] = []) => ({
  name,
  kind: 'open' as const,
  rotDays,
  requiredFieldKeys,
});
const won = (name: string) => ({ name, kind: 'won' as const, rotDays: null, requiredFieldKeys: [] });
const lost = (name: string) => ({ name, kind: 'lost' as const, rotDays: null, requiredFieldKeys: [] });

const realEstate: OnboardingProposal = {
  businessSummary: 'Real estate agency selling plots, houses and apartments.',
  pipelines: [
    {
      name: 'Property sales',
      stages: [
        open('New inquiry', 2),
        open('Site visit', 5, ['budget', 'property_type']),
        open('Negotiation', 7, ['visit_date']),
        open('Token paid', 7),
        won('Sold'),
        lost('Lost'),
      ],
    },
  ],
  fields: [
    {
      entity: 'contact',
      key: 'budget',
      label: { en: 'Budget (PKR)', ur: 'بجٹ (روپے)' },
      type: 'number',
      options: [],
    },
    {
      entity: 'contact',
      key: 'property_type',
      label: { en: 'Property type', ur: 'جائیداد کی قسم' },
      type: 'dropdown',
      options: [
        opt('house', 'House', 'گھر'),
        opt('plot', 'Plot', 'پلاٹ'),
        opt('apartment', 'Apartment', 'اپارٹمنٹ'),
        opt('commercial', 'Commercial', 'کمرشل'),
      ],
    },
    {
      entity: 'contact',
      key: 'preferred_area',
      label: { en: 'Preferred area', ur: 'پسندیدہ علاقہ' },
      type: 'text',
      options: [],
    },
    {
      entity: 'opportunity',
      key: 'visit_date',
      label: { en: 'Site visit date', ur: 'سائٹ وزٹ کی تاریخ' },
      type: 'date',
      options: [],
    },
    {
      entity: 'opportunity',
      key: 'buying_purpose',
      label: { en: 'Buying purpose', ur: 'خریداری کا مقصد' },
      type: 'dropdown',
      options: [opt('living', 'Living', 'رہائش'), opt('investment', 'Investment', 'سرمایہ کاری')],
    },
  ],
  tags: ['Hot lead', 'Investor', 'Overseas buyer', 'First-time buyer', 'Follow up'],
};

const solar: OnboardingProposal = {
  businessSummary: 'Solar installer quoting and installing rooftop systems for homes and businesses.',
  pipelines: [
    {
      name: 'Solar installations',
      stages: [
        open('New inquiry', 2),
        open('Site survey', 5, ['monthly_bill']),
        open('Quotation sent', 7, ['roof_type']),
        open('Negotiation', 7),
        won('Installed'),
        lost('Lost'),
      ],
    },
  ],
  fields: [
    {
      entity: 'contact',
      key: 'monthly_bill',
      label: { en: 'Monthly electricity bill (PKR)', ur: 'ماہانہ بجلی کا بل (روپے)' },
      type: 'number',
      options: [],
    },
    {
      entity: 'contact',
      key: 'roof_type',
      label: { en: 'Roof type', ur: 'چھت کی قسم' },
      type: 'dropdown',
      options: [
        opt('flat', 'Flat concrete', 'پختہ چھت'),
        opt('sloped', 'Sloped', 'ڈھلوانی چھت'),
        opt('metal', 'Metal sheet', 'چادر والی چھت'),
      ],
    },
    {
      entity: 'contact',
      key: 'net_metering',
      label: { en: 'Wants net metering', ur: 'نیٹ میٹرنگ چاہیے' },
      type: 'checkbox',
      options: [],
    },
    {
      entity: 'opportunity',
      key: 'system_size_kw',
      label: { en: 'System size (kW)', ur: 'سسٹم کا سائز (کلو واٹ)' },
      type: 'number',
      options: [],
    },
    {
      entity: 'opportunity',
      key: 'survey_date',
      label: { en: 'Survey date', ur: 'سروے کی تاریخ' },
      type: 'date',
      options: [],
    },
  ],
  tags: ['Residential', 'Commercial', 'Net metering', 'Hot lead', 'Referral'],
};

const clinic: OnboardingProposal = {
  businessSummary: 'Clinic booking consultations and treatments for walk-in and WhatsApp patients.',
  pipelines: [
    {
      name: 'Patient journey',
      stages: [
        open('Inquiry', 1),
        open('Appointment booked', 3, ['service']),
        open('Visited', 5),
        open('Treatment plan offered', 7),
        won('Treatment accepted'),
        lost('Not interested'),
      ],
    },
  ],
  fields: [
    {
      entity: 'contact',
      key: 'service',
      label: { en: 'Service wanted', ur: 'مطلوبہ خدمت' },
      type: 'dropdown',
      options: [
        opt('consultation', 'Consultation', 'مشاورت'),
        opt('checkup', 'Check-up', 'معائنہ'),
        opt('procedure', 'Procedure', 'علاج / طریقہ کار'),
        opt('follow_up', 'Follow-up visit', 'فالو اپ وزٹ'),
      ],
    },
    {
      entity: 'contact',
      key: 'preferred_time',
      label: { en: 'Preferred time', ur: 'پسندیدہ وقت' },
      type: 'dropdown',
      options: [
        opt('morning', 'Morning', 'صبح'),
        opt('afternoon', 'Afternoon', 'دوپہر'),
        opt('evening', 'Evening', 'شام'),
      ],
    },
    {
      entity: 'contact',
      key: 'first_visit',
      label: { en: 'First visit', ur: 'پہلی بار آ رہے ہیں' },
      type: 'checkbox',
      options: [],
    },
    {
      entity: 'opportunity',
      key: 'appointment_date',
      label: { en: 'Appointment date', ur: 'اپائنٹمنٹ کی تاریخ' },
      type: 'date',
      options: [],
    },
  ],
  tags: ['New patient', 'Follow up', 'Urgent', 'Insurance', 'Referral'],
};

export const ONBOARDING_TEMPLATES: readonly OnboardingTemplateDto[] = [
  {
    id: 'real_estate',
    name: { en: 'Real estate', ur: 'رئیل اسٹیٹ' },
    description: {
      en: 'Inquiries to site visits, negotiation and token. Budget, property type and area.',
      ur: 'پوچھ گچھ سے سائٹ وزٹ، بات چیت اور ٹوکن تک۔ بجٹ، جائیداد کی قسم اور علاقہ۔',
    },
    proposal: realEstate,
  },
  {
    id: 'solar',
    name: { en: 'Solar', ur: 'سولر' },
    description: {
      en: 'Inquiry, site survey, quotation and installation. Bill, roof type and system size.',
      ur: 'پوچھ گچھ، سائٹ سروے، کوٹیشن اور انسٹالیشن۔ بل، چھت کی قسم اور سسٹم کا سائز۔',
    },
    proposal: solar,
  },
  {
    id: 'clinic',
    name: { en: 'Clinic', ur: 'کلینک' },
    description: {
      en: 'Patient inquiry to appointment, visit and treatment plan. Service and preferred time.',
      ur: 'مریض کی پوچھ گچھ سے اپائنٹمنٹ، وزٹ اور علاج کے منصوبے تک۔ خدمت اور پسندیدہ وقت۔',
    },
    proposal: clinic,
  },
];

const KEYWORDS: Record<TemplateId, RegExp> = {
  real_estate:
    /real\s*estate|propert|plot|house|apartment|housing|society|realtor|builder|رئیل|پلاٹ|جائیداد|مکان/i,
  solar: /solar|panel|inverter|net\s*meter|photovolt|سولر|شمسی/i,
  clinic:
    /clinic|dental|dentist|doctor|hospital|patient|medical|physio|derma|health|کلینک|ڈاکٹر|دانت|ہسپتال|مریض/i,
};

/** Best built-in template for a free-text description (no-AI fallback), or null. */
export function matchTemplate(description: string): TemplateId | null {
  for (const id of Object.keys(KEYWORDS) as TemplateId[]) if (KEYWORDS[id].test(description)) return id;
  return null;
}
