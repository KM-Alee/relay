// Static localized templates (en / ur / ur-Latn). Used when AI is off, slow, over budget, or a guard
// trips. They contain no prices, names, times or promises (F6.8, F6.11). Workspaces can override via
// message_templates (T-208); these are the built-in defaults.
import type { Lang } from './types';

const FALLBACK: Record<Lang, string> = {
  en: 'Thanks for your message. A team member will reply to you shortly.',
  ur: 'آپ کے پیغام کا شکریہ۔ ہماری ٹیم کا کوئی رکن جلد آپ کو جواب دے گا۔',
  'ur-Latn': 'Aap ke message ka shukriya. Hamari team ka koi member jald aap ko jawab dega.',
};

const HOLDING: Record<Lang, string> = {
  en: 'I have passed your message to our team. A team member will take over and reply to you shortly.',
  ur: 'میں نے آپ کا پیغام ہماری ٹیم تک پہنچا دیا ہے۔ ٹیم کا کوئی رکن جلد آپ سے رابطہ کرے گا۔',
  'ur-Latn':
    'Maine aap ka message hamari team tak pohncha diya hai. Team ka koi member jald aap se rabta karega.',
};

/** Static reply when the AI is unavailable (disabled / timeout / over budget / invalid output). */
export function fallbackReply(lang: Lang): string {
  return FALLBACK[lang] ?? FALLBACK.en;
}

/** Short holding message for hard handoffs (F6.9). */
export function holdingReply(lang: Lang): string {
  return HOLDING[lang] ?? HOLDING.en;
}

/** First-AI-message disclosure (F6.3). `ownerFirstName` only when custody is a real handler (F6.7). */
export function disclosure(lang: Lang, workspaceName: string, ownerFirstName?: string | null): string {
  const w = workspaceName.trim() || 'our';
  const n = ownerFirstName?.trim();
  switch (lang) {
    case 'ur':
      return n
        ? `میں ${w} کا اسسٹنٹ ہوں؛ ہماری ٹیم سے ${n} جلد آپ کے ساتھ شامل ہوں گے۔`
        : `میں ${w} کا اسسٹنٹ ہوں؛ ہماری ٹیم کا کوئی رکن جلد آپ کے ساتھ شامل ہوگا۔`;
    case 'ur-Latn':
      return n
        ? `Main ${w} ka assistant hoon; hamari team se ${n} jald aap ke saath shamil hon ge.`
        : `Main ${w} ka assistant hoon; hamari team ka koi member jald aap ke saath shamil hoga.`;
    default:
      return n
        ? `I'm the ${w} assistant; ${n} from our team will join shortly.`
        : `I'm the ${w} assistant; a team member will join shortly.`;
  }
}

/** "X has joined the chat" confirmation sent when a human takes over (F6.10). */
export function humanJoined(lang: Lang, name: string): string {
  const n = name.trim() || (lang === 'en' ? 'A team member' : '');
  switch (lang) {
    case 'ur':
      return `${n || 'ہماری ٹیم کا رکن'} چیٹ میں شامل ہو گئے ہیں۔`;
    case 'ur-Latn':
      return `${n || 'Hamari team ka member'} chat mein shamil ho gaye hain.`;
    default:
      return `${n} has joined the chat.`;
  }
}
