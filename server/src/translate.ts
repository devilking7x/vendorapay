// Vendora Pay AI — real-time translation for agent chat.
// Heuristic language detection (Devanagari = Hindi, else English) +
// optional real translation via the configured AI provider.
// HONESTY: without an AI key, no translation is performed — the original
// text is returned with translated:false. Never fake a translation.

import { aiChatJSON, aiMode } from "./ai.js";

export type Lang = "en" | "hi" | "hi-roman";

/** Strong Roman-Hindi tokens: distinctly Hindi, essentially never English. */
const HI_ROMAN_STRONG = new Set(
  "kitne kitna kitni kitne kya kyon kyun kaise kab kahan kaha kaun bhai behen didi yaar arey arre nahi nahin accha acha achha bahut bohot zyada jyada chahiye sakta sakti sakte hoga hogi honge karo karein batao bata dekho dekhe suno suniye bolo boliye samjho samajh mujhe tumhe tumhara tumhari tumhare hamara hamari hamare aapka aapki aapke iska iski iske uska uski uske inka inki unka unki wala wali wale liye saath sath andar bahar upar neeche paise rupay rupaye daam keemat kimat sasta sasti mehenga mehnga dukan dukaan samaan saaman cheez cheezen kripya dhanyavad shukriya".split(
    " "
  )
);

/** Weak Roman-Hindi tokens: common in Hindi but plausible as English fragments/typos. */
const HI_ROMAN_WEAK = new Set(
  "hai hain ho raha rahi rahe tha thi the mein me main ne ko se pe par ka ki ke ko ye yeh yah wo woh woh jo jis jin jab tab ab yahan wahan".split(
    " "
  )
);

/**
 * Heuristic language detection.
 * - Devanagari script range => "hi" (Hindi)
 * - Roman Hindi scoring => "hi-roman" (Hindi written in Latin script)
 * - everything else => "en"
 * This is a heuristic, not AI — labeled as such.
 *
 * Roman-Hindi scoring: strong tokens weigh 2, weak tokens weigh 1.
 * Requires score/totalWords >= 0.3 AND (at least 1 strong token OR 3+ weak
 * tokens). This avoids false positives like "me and ke went" (2 weak, no
 * strong => English).
 */
export function detectLanguage(text: string): { lang: Lang; method: string } {
  if (/[\u0900-\u097F]/.test(text)) {
    return { lang: "hi", method: "heuristic (Devanagari script detected — not AI)" };
  }
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length > 0) {
    let strong = 0;
    let weak = 0;
    for (const w of words) {
      if (HI_ROMAN_STRONG.has(w)) strong++;
      else if (HI_ROMAN_WEAK.has(w)) weak++;
    }
    const score = (strong * 2 + weak) / words.length;
    if (score >= 0.3 && (strong >= 1 || weak >= 3)) {
      return {
        lang: "hi-roman",
        method: "heuristic (Roman Hindi token scoring — not AI)",
      };
    }
  }
  return { lang: "en", method: "heuristic (default — not AI)" };
}

export interface TranslationResult {
  /** the translated text, or the ORIGINAL when translation wasn't possible */
  text: string;
  translated: boolean;
  /** honest engine label */
  engine: string;
  from: Lang;
  to: Lang;
}

/**
 * Translate text. Uses the real AI provider when a key is configured.
 * Without a key: returns the original text with translated:false.
 */
export async function translate(
  text: string,
  from: Lang,
  to: Lang
): Promise<TranslationResult> {
  if (from === to) {
    return { text, translated: false, engine: "noop (same language)", from, to };
  }
  if (aiMode() === "template") {
    return {
      text, // original, NOT translated
      translated: false,
      engine: "no AI key — translation skipped (not translated)",
      from,
      to,
    };
  }
  // "hi-roman" is Hindi written in Latin script — same target language for the model.
  const fromLabel = from === "en" ? "English" : "Hindi";
  const toLabel = to === "en" ? "English" : "Hindi";
  try {
    const r = await aiChatJSON<{ translation: string }>(
      `Translate the following ${fromLabel} text to ${toLabel}. Reply with ONLY JSON: {"translation": "..."}. Keep prices, numbers and product names exactly as-is.\n\nText: ${text.slice(0, 500)}`,
      { maxTokens: 400, temperature: 0.3, timeoutMs: 12000 }
    );
    if (r?.data?.translation) {
      return {
        text: r.data.translation,
        translated: true,
        engine: r.engine, // provider name — only set on real API success
        from,
        to,
      };
    }
  } catch {
    /* fall through to honest failure */
  }
  return {
    text, // original, NOT translated
    translated: false,
    engine: "AI translation failed — showing original (not translated)",
    from,
    to,
  };
}
