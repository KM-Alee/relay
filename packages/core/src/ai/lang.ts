// Customer language detection (docs/05-ai.md §6, F7.5). Pure and deterministic; works with AI off.
import type { Lang } from './types';

const ARABIC = new RegExp('[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFD]', 'g');
const LATIN = /[A-Za-z]/g;

// Roman-Urdu lexicon. Words that are also common English words ("main", "par", "the") are kept out.
const ROMAN_URDU = new Set(
  (
    'hai hain hun hoon tha thi nahi nahin nai kya kyun kyu kaise kaisay kitne kitna kitni ' +
    'chahiye chahiay chahye mujhe mujhy mera meri mere humein hamein aap apka aapka aapko tum tumhara ' +
    'bhai bhaijan kal aaj abhi theek thik acha achha accha paise paisay rupay ghar kab kahan kahaan ' +
    'karna karni karein karen karo kro kijiye kijiyega krna sakte sakta sakti ' +
    'wala wali walay mein aur lekin magar bohat bahut zyada thora thoda ' +
    'jaldi bataein batao bataen btao batayen salam assalam walaikum shukriya jazakallah haan ' +
    'lagwana lagwani lagana wapis chahta chahti chahtay milna jayega ' +
    'qeemat keemat mehngai munasib subah shaam raat hafta mahina kaam masla ' +
    'insaan banda bande kisi koi kuch sirf pehle baad phir yahan wahan idhar udhar dukaan dafa'
  ).split(/\s+/),
);

export function arabicRatio(text: string): number {
  const a = text.match(ARABIC)?.length ?? 0;
  const l = text.match(LATIN)?.length ?? 0;
  return a + l === 0 ? 0 : a / (a + l);
}

/** Detect Urdu script / Roman Urdu / English. */
export function detect(text: string): Lang {
  const letters = (text.match(ARABIC)?.length ?? 0) + (text.match(LATIN)?.length ?? 0);
  if (letters === 0) return 'en';
  if (arabicRatio(text) >= 0.4) return 'ur';
  const tokens = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const hits = tokens.filter((t) => ROMAN_URDU.has(t)).length;
  if (hits >= 2 || (tokens.length > 0 && hits / tokens.length >= 0.25)) return 'ur-Latn';
  return 'en';
}

/** Detect from the most recent customer message that has letters (newest wins). */
export function detectFromMessages(texts: string[]): Lang {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i]!;
    if (/[A-Za-z؀-ۿ]{2,}/.test(t)) return detect(t);
  }
  return 'en';
}
