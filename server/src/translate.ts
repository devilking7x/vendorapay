// Vendora Pay AI — real-time translation for agent chat.
// Heuristic language detection (Devanagari = Hindi, else English) +
// optional real translation via the configured AI provider.
// HONESTY: without an AI key, no translation is performed — the original
// text is returned with translated:false. Never fake a translation.

import { aiChatJSON, aiMode } from "./ai.js";

export type Lang = "en" | "hi";

/**
 * Heuristic language detection. Devanagari script range => Hindi,
 * everything else => English. This is a heuristic, not AI — labeled as such.
 */
export function detectLanguage(text: string): { lang: Lang; method: string } {
  if (/[\u0900-\u097F]/.test(text)) {
    return { lang: "hi", method: "heuristic (Devanagari script detected — not AI)" };
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
  try {
    const r = await aiChatJSON<{ translation: string }>(
      `Translate the following ${from === "hi" ? "Hindi" : "English"} text to ${
        to === "hi" ? "Hindi" : "English"
      }. Reply with ONLY JSON: {"translation": "..."}. Keep prices, numbers and product names exactly as-is.\n\nText: ${text.slice(0, 500)}`,
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
