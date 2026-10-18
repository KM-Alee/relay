// Pure seed data for the AI knowledge base (no imports: also used by `pnpm ai:eval`). Owner: Lane C.
export interface SeedKb {
  kind: 'pricing' | 'service' | 'faq' | 'hours' | 'area';
  title: string;
  body: string;
  language: 'en' | 'ur' | 'ur-Latn';
}

export const SEED_KB: Record<'sunrise' | 'crescent', SeedKb[]> = {
  sunrise: [
    {
      kind: 'pricing',
      title: 'Solar packages and indicative prices',
      body: 'Indicative starting prices for complete on-grid systems (panels, inverter, structure, installation, net metering paperwork): 3kW from Rs 480,000; 5kW from Rs 760,000; 10kW from Rs 1,450,000. Hybrid systems with battery cost more. The final quote is prepared by our team after a free site survey.',
      language: 'en',
    },
    {
      kind: 'pricing',
      title: 'Solar packages ke andazi rate',
      body: 'Complete on-grid system (panels, inverter, structure, installation, net metering) ke andazi rate: 3kW Rs 480,000 se; 5kW Rs 760,000 se; 10kW Rs 1,450,000 se. Battery wale hybrid system ka rate zyada hota hai. Final quotation free site survey ke baad hamari team deti hai.',
      language: 'ur-Latn',
    },
    {
      kind: 'service',
      title: 'Free site survey',
      body: 'We do a free site survey before every quote: roof space, shading, load and electricity bill review. Surveys take about 45 minutes and are booked by our team.',
      language: 'en',
    },
    {
      kind: 'faq',
      title: 'Financing and instalments',
      body: 'Instalment plans are available through partner banks (up to 36 months) and 50% advance / 50% on completion for cash customers. Approval and rates depend on the bank, so our team explains the options after the survey.',
      language: 'en',
    },
    {
      kind: 'area',
      title: 'Service areas',
      body: 'We install in Lahore and Islamabad/Rawalpindi, and nearby areas on request. Installation usually takes 3 to 5 working days after the material arrives.',
      language: 'en',
    },
    {
      kind: 'area',
      title: 'Service areas (Roman Urdu)',
      body: 'Hum Lahore aur Islamabad/Rawalpindi mein installation karte hain, qareebi ilaqon mein request par. Material aane ke baad installation mein aam taur par 3 se 5 working days lagte hain.',
      language: 'ur-Latn',
    },
    {
      kind: 'service',
      title: 'Warranty and service',
      body: 'Panels: 12 years product warranty and 25 years performance warranty. Inverter: 5 years. Installation workmanship: 2 years. Annual maintenance visits are available.',
      language: 'en',
    },
    {
      kind: 'faq',
      title: 'Net metering',
      body: 'We handle the net metering application with your distribution company (LESCO/IESCO) as part of an on-grid package. Approval timelines depend on the utility.',
      language: 'en',
    },
    {
      kind: 'hours',
      title: 'Business hours',
      body: 'Monday to Saturday, 9am to 6pm. Messages sent outside these hours are answered the next working morning.',
      language: 'en',
    },
    {
      kind: 'service',
      title: 'سولر سسٹم اور سروے',
      body: 'ہم لاہور اور اسلام آباد میں چھتوں پر سولر سسٹم لگاتے ہیں۔ ہر کوٹیشن سے پہلے مفت سائٹ سروے کیا جاتا ہے۔ حتمی قیمت سروے کے بعد ہماری ٹیم بتاتی ہے۔',
      language: 'ur',
    },
  ],
  crescent: [
    {
      kind: 'service',
      title: 'What we do',
      body: 'Crescent Realty helps you buy, sell and rent residential plots, houses and apartments in Islamabad (DHA, Bahria Town, Gulberg Greens) and Lahore (DHA, Bahria Town). Our agents arrange viewings on request.',
      language: 'en',
    },
    {
      kind: 'pricing',
      title: 'Prices and commission',
      body: 'Property prices change daily, so our agents share current listings and prices after understanding your budget. Our service commission is 1% for buyers and 1% for sellers, agreed in writing before any deal.',
      language: 'en',
    },
    {
      kind: 'faq',
      title: 'Viewings',
      body: 'Viewings are arranged by an agent, usually within 48 hours. Please share your preferred area, budget and a convenient time.',
      language: 'en',
    },
    {
      kind: 'faq',
      title: 'Documents for buying',
      body: 'For purchase you will need your CNIC copy and, for overseas buyers, a power of attorney. Our team guides you through transfer and registration.',
      language: 'en',
    },
    {
      kind: 'area',
      title: 'Areas ka zikr (Roman Urdu)',
      body: 'Hum Islamabad (DHA, Bahria Town, Gulberg Greens) aur Lahore (DHA, Bahria Town) mein plots, ghar aur apartments ki buying, selling aur rent mein madad karte hain.',
      language: 'ur-Latn',
    },
    {
      kind: 'hours',
      title: 'Office hours',
      body: 'Monday to Saturday, 10am to 7pm. Sunday by appointment.',
      language: 'en',
    },
  ],
};
