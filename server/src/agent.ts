// Vendora Pay AI — Agentic Salesperson (flagship).
// An AI agent that runs a sale autonomously WITH guardrails:
//  - negotiates price ONLY within the seller's [minPrice, maxPrice] bounds
//  - NEVER creates a charge without explicit seller confirmation
//  - every decision is logged as a reasoning step (transparency)
// Price parsing is deterministic; the LLM is never trusted with numbers.
//
// Reasoning brain: the salesperson consults a SalesBrain (see ./brain/) for
// intent analysis + reply phrasing, but ALL guardrails are enforced OUTSIDE
// the brain — brain proposes, guardrails dispose. A validator vetoes any
// brain draft that invents prices or claims a charge happened.

import { createOrder } from "./paypal.js";
import {
  createSalesBrain,
  validateDraft,
  type BrainAnalysis,
  type DecidedFacts,
  type SalesBrain,
  type SalesContext,
} from "./brain/index.js";
import { detectLanguage, translate } from "./translate.js";
import {
  countUpsellAccepted,
  countUpsellSuggested,
  getPage,
  getSession,
  listSessions,
  rid,
  saveOrder,
  saveSession,
  type AgentSession,
  type AgentStep,
  type Order,
} from "./store.js";

// Lazy singleton — created on first sale so env is settled.
let _brain: SalesBrain | null = null;
function brain(): SalesBrain {
  if (!_brain) _brain = createSalesBrain();
  return _brain;
}

function parsePrice(text: string): number | null {
  // matches $40, 40$, 40 dollars, USD 40, 40.50
  const m = text.match(
    /(?:\$\s?|USD\s?|dollars?\s?)(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(?:\$|dollars?|USD)/i
  );
  if (!m) return null;
  const v = Number(m[1] ?? m[2]);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

const YES = /^(yes|yeah|yep|ok|okay|sure|deal|done|accept|agreed|sounds good)\b/i;
const UPSELL_NO = /^(no|nope|nah|not interested|pass|skip)\b/i;
const UPSELL_PITCH_MARKER = "Want me to add it to your deal?";

export function startSession(args: {
  pageId: string;
  productId: string;
  buyerName: string;
  minPrice?: number;
  maxPrice?: number;
}): AgentSession | null {
  const page = getPage(args.pageId);
  if (!page) return null;
  const product = page.products.find((p) => p.id === args.productId);
  if (!product) return null;

  const minPrice =
    typeof args.minPrice === "number" && args.minPrice > 0
      ? Math.min(args.minPrice, product.price)
      : product.minPrice;
  const maxPrice =
    typeof args.maxPrice === "number" && args.maxPrice >= minPrice
      ? args.maxPrice
      : product.price;

  const s: AgentSession = {
    id: rid("agent"),
    pageId: page.id,
    productId: product.id,
    productName: product.name,
    buyerName: args.buyerName.trim().slice(0, 40) || "Buyer",
    currency: product.currency,
    minPrice,
    maxPrice,
    state: "active",
    messages: [
      {
        role: "agent",
        text:
          `Hi ${args.buyerName.trim() || "there"}! I'm ${page.sellerName}'s sales assistant. ` +
          `"${product.name}" is listed at ${product.price} ${product.currency}. ` +
          `Want to talk price? I can work with you — within reason.`,
        at: new Date().toISOString(),
      },
    ],
    steps: [
      {
        step: 1,
        reasoning: `Session opened for "${product.name}". Seller bounds: [${minPrice}, ${maxPrice}] ${product.currency}. I will never agree outside these bounds and never charge without seller confirmation.`,
        action: "greeted buyer, stated list price",
      },
    ],
    pendingCharge: null,
    createdAt: new Date().toISOString(),
  };
  // track last counter offer on the session object (not persisted in type? it is via any)
  (s as unknown as { lastAgentOffer?: number }).lastAgentOffer = undefined;
  saveSession(s);

  // Upsell acceptance tracking: did this buyer start a session for a product
  // that was suggested as an upsell in an earlier session? (honest signal)
  for (const prev of listSessions(page.id)) {
    if (
      prev.id !== s.id &&
      prev.buyerName === s.buyerName &&
      prev.upsellSuggested &&
      prev.upsellProductId === args.productId &&
      !prev.upsellDeclined
    ) {
      countUpsellAccepted();
      s.steps.push({
        step: s.steps.length + 1,
        reasoning: `Buyer started a session for "${product.name}" after it was suggested as an upsell — counted as an accepted upsell.`,
        action: "upsell accepted (new session for suggested product)",
      });
      saveSession(s);
      break;
    }
  }
  return s;
}

function lastOffer(s: AgentSession): number | undefined {
  return (s as unknown as { lastAgentOffer?: number }).lastAgentOffer;
}
function setLastOffer(s: AgentSession, v: number | undefined): void {
  (s as unknown as { lastAgentOffer?: number }).lastAgentOffer = v;
}

function pushStep(s: AgentSession, reasoning: string, action: string): void {
  s.steps.push({ step: s.steps.length + 1, reasoning, action });
}

function say(s: AgentSession, role: "buyer" | "agent" | "system", text: string): void {
  s.messages.push({ role, text, at: new Date().toISOString() });
}

/**
 * Smart upsell: suggest ONE complementary product from the same page.
 * Guardrails: max 1 per conversation, same page only, offered price never
 * below the product's floor (seller bound), never on complaints, and a
 * "no" is accepted gracefully with no repeat. Returns the pitch text or null.
 */
function maybeUpsell(s: AgentSession, analysis: BrainAnalysis): string | null {
  if (s.upsellSuggested || s.upsellDeclined) return null; // max 1 per conversation
  if (s.state !== "active") return null;
  // Only on genuine buying signals (questions / explicit interest in more) —
  // never on complaints, price haggling, or smalltalk.
  if (!["question", "upsell-opportunity"].includes(analysis.intent)) {
    return null;
  }
  const page = getPage(s.pageId);
  if (!page) return null;
  const others = page.products.filter((p) => p.id !== s.productId);
  if (others.length === 0) return null;
  const upsell = others[0];
  // Combo sweetener: 10% off, but NEVER below the seller's floor for that product.
  const discounted = Math.max(upsell.minPrice, Math.round(upsell.price * 0.9 * 100) / 100);
  const pct = Math.round((1 - discounted / upsell.price) * 100);
  s.upsellSuggested = true;
  s.upsellProductId = upsell.id;
  countUpsellSuggested();
  pushStep(
    s,
    `Upsell guardrails passed: "${upsell.name}" is from the SAME page, offered at ${discounted} ${upsell.currency} ` +
      `(floor ${upsell.minPrice} — never below). One suggestion max per conversation.`,
    `suggested bundle: "${upsell.name}" at ${discounted} ${upsell.currency}`
  );
  const deal =
    pct > 0
      ? ` — I can do ${discounted} ${upsell.currency} for you (${pct}% off)`
      : ` at ${upsell.price} ${upsell.currency}`;
  return (
    `\n\nBy the way — since you're looking at "${s.productName}", you might also like ` +
    `"${upsell.name}"${deal}. ${UPSELL_PITCH_MARKER} No pressure at all!`
  );
}

/**
 * One buyer message -> agent response.
 *
 * 1. Brain analyzes the message (advisory strategy, logged with reasoning).
 * 2. DETERMINISTIC guardrails decide the outcome: accept / counter / cap /
 *    ask / clarify. Agreed price ALWAYS lands inside [minPrice, maxPrice].
 * 3. Brain drafts the reply phrasing; the guardrail validator vetoes any
 *    draft that invents a price or claims a charge happened.
 */
export async function agentStep(
  sessionId: string,
  buyerMessage: string
): Promise<{ session: AgentSession; reply: string } | null> {
  const s = getSession(sessionId);
  if (!s || s.state === "declined" || s.state === "completed") return null;
  if (s.state === "awaiting_seller_confirm" || s.state === "confirmed") {
    return {
      session: s,
      reply:
        "We're just waiting on the seller to confirm — I'll ping you the moment it's approved!",
    };
  }

  const msg = buyerMessage.trim().slice(0, 500);
  say(s, "buyer", msg);

  // --- Translation: detect buyer language; translate Hindi -> English for the seller ---
  const buyerMsg = s.messages[s.messages.length - 1];
  const { lang } = detectLanguage(msg);
  buyerMsg.lang = lang;
  if (lang === "hi") {
    try {
      const t = await translate(msg, "hi", "en");
      buyerMsg.translatedText = t.text;
      buyerMsg.translationAI = t.translated;
      pushStep(
        s,
        `Buyer wrote in Hindi [${t.engine}]. ${t.translated ? "Translated to English for the seller." : "No AI key — showing original text."}`,
        t.translated ? "translated buyer message (hi->en)" : "translation skipped (no key)"
      );
    } catch {
      buyerMsg.translationAI = false;
    }
  }

  // --- Upsell "no": accept gracefully, never suggest again ---
  const lastAgentMsg = [...s.messages].reverse().find((m) => m.role === "agent");
  const justOfferedUpsell =
    s.upsellSuggested && !s.upsellDeclined && lastAgentMsg?.text.includes(UPSELL_PITCH_MARKER);
  if (justOfferedUpsell && UPSELL_NO.test(msg)) {
    s.upsellDeclined = true;
    pushStep(
      s,
      `Buyer declined the upsell ("${msg}") — accepted gracefully, will not suggest again.`,
      "upsell declined gracefully"
    );
    const reply = `Totally fine — no pressure! Let's focus on "${s.productName}".`;
    say(s, "agent", reply);
    saveSession(s);
    return { session: s, reply };
  }

  const offered = parsePrice(msg);
  const { minPrice, maxPrice, currency } = s;

  // --- 1. Brain: advisory strategy analysis (never decides money) ---
  const b = brain();
  const page = getPage(s.pageId);
  const ctx: SalesContext = {
    productName: s.productName,
    sellerName: page?.sellerName ?? "the seller",
    buyerName: s.buyerName,
    currency,
    listPrice: maxPrice,
    minPrice,
    maxPrice,
    lastAgentOffer: lastOffer(s),
    history: s.messages.slice(-6).map((m) => `${m.role}: ${m.text}`),
  };
  let analysis: BrainAnalysis;
  try {
    analysis = await b.analyzeBuyerMessage(msg, ctx);
  } catch (e) {
    analysis = {
      intent: "unknown",
      suggestedStrategy: "proceed with deterministic guardrails",
      reasoning: `brain error (${(e as Error).message}) — continuing without brain strategy`,
      engine: "error-fallback (rule-based — not AI)",
    };
  }
  pushStep(
    s,
    `Brain analysis [${analysis.engine}]: ${analysis.reasoning}`,
    `intent=${analysis.intent}; advisory strategy: ${analysis.suggestedStrategy}`
  );

  // --- 2. Deterministic guardrails: outcome + base reply (facts) ---
  let decided: DecidedFacts;
  let baseReply: string;

  // Buyer accepted our last counter with a plain "yes"
  if (offered === null && YES.test(msg)) {
    const lo = lastOffer(s);
    if (lo !== undefined) {
      s.pendingCharge = { amount: lo, currency };
      s.state = "awaiting_seller_confirm";
      pushStep(
        s,
        `Buyer accepted my counter of ${lo} ${currency} with "${msg}". ${lo} is within [${minPrice}, ${maxPrice}].`,
        `locked pending charge at ${lo} ${currency} — waiting for SELLER confirmation (no charge created)`
      );
      decided = { action: "accept", amount: lo, currency };
      baseReply =
        `Deal! ${lo} ${currency} it is. I've sent it to the seller for final confirmation — ` +
        `you'll get the PayPal checkout link as soon as they approve.`;
    } else {
      pushStep(s, `Buyer said "${msg}" with no active offer on the table.`, "asked for explicit price confirmation");
      decided = { action: "clarify", amount: maxPrice, currency };
      baseReply = `Happy to lock it in! Just to be clear — are you agreeing to ${maxPrice} ${currency} (the listed price)? Say "yes" or name your price.`;
    }
  } else if (offered === null) {
    pushStep(s, `No price found in "${msg}".`, "asked buyer for their budget");
    decided = { action: "ask-budget", currency };
    baseReply =
      `I can work with you on the price — "${s.productName}" is listed at ${maxPrice} ${currency}. ` +
      `What's your budget?`;
  } else if (offered > maxPrice) {
    // Guardrail: buyer tries to push ABOVE the ceiling -> cap at maxPrice, never exceed
    s.pendingCharge = { amount: maxPrice, currency };
    s.state = "awaiting_seller_confirm";
    pushStep(
      s,
      `Buyer offered ${offered} ${currency} — ABOVE the seller's ceiling of ${maxPrice}. ` +
        `Guardrail: I never agree above maxPrice, so I capped at the ceiling.`,
      `locked pending charge at ceiling ${maxPrice} ${currency} — waiting for SELLER confirmation`
    );
    decided = { action: "cap-at-ceiling", amount: maxPrice, currency };
    baseReply =
      `That's generous! The most I can accept is the listed ${maxPrice} ${currency} — ` +
      `deal at that? I've sent it to the seller for final confirmation.`;
  } else if (offered >= minPrice) {
    // Inside bounds -> accept
    s.pendingCharge = { amount: offered, currency };
    s.state = "awaiting_seller_confirm";
    setLastOffer(s, undefined);
    pushStep(
      s,
      `Buyer offered ${offered} ${currency}, inside bounds [${minPrice}, ${maxPrice}]. Acceptable.`,
      `locked pending charge at ${offered} ${currency} — waiting for SELLER confirmation (no charge created)`
    );
    decided = { action: "accept", amount: offered, currency };
    baseReply =
      `Done — ${offered} ${currency} works! I've sent it to the seller for final confirmation. ` +
      `You'll get the PayPal checkout link once they approve.`;
  } else {
    // Below floor -> counter, never accept
    const counter = Math.max(minPrice, Math.round(((minPrice + offered) / 2) * 100) / 100);
    setLastOffer(s, counter);
    pushStep(
      s,
      `Buyer offered ${offered} ${currency} — BELOW the floor of ${minPrice}. ` +
        `Guardrail: I cannot agree below minPrice. Countering at ${counter} (midpoint, still >= floor).`,
      `countered at ${counter} ${currency}; no charge, no agreement below bounds`
    );
    decided = { action: "counter", amount: counter, currency };
    baseReply =
      `Hmm, ${offered} ${currency} is below what the seller can do. ` +
      `How about ${counter} ${currency}? Say "yes" and I'll lock it in for seller approval.`;
  }

  // --- 3. Brain drafts phrasing; guardrail validator has the final say ---
  let reply = baseReply;
  try {
    const draft = await b.draftReply(analysis, ctx, decided, baseReply);
    pushStep(
      s,
      `Brain draft [${draft.engine}]: ${draft.reasoning}`,
      "drafted reply phrasing (facts fixed by guardrails)"
    );
    const rejection = validateDraft(draft.text, decided);
    if (rejection) {
      pushStep(
        s,
        `Brain draft REJECTED by guardrail validator: ${rejection}.`,
        "validator veto — deterministic reply kept"
      );
    } else {
      reply = draft.text;
      pushStep(s, "Brain draft passed validation.", "sending brain-drafted reply");
    }
  } catch (e) {
    pushStep(
      s,
      `Brain draft error (${(e as Error).message}) — deterministic reply kept.`,
      "draft skipped"
    );
  }

  // --- Smart upsell: one complementary product, same page, floor-respecting ---
  const upsellPitch = maybeUpsell(s, analysis);
  if (upsellPitch) reply += upsellPitch;

  // --- Reply translation: buyer wrote Hindi -> also show agent reply in Hindi ---
  const agentMsgLang = buyerMsg.lang ?? "en";
  let replyTranslatedText: string | undefined;
  let replyTranslationAI = false;
  if (agentMsgLang === "hi") {
    try {
      const t = await translate(reply, "en", "hi");
      if (t.translated) {
        replyTranslatedText = t.text;
        replyTranslationAI = true;
        pushStep(s, `Agent reply translated to Hindi [${t.engine}].`, "translated agent reply (en->hi)");
      }
    } catch {
      /* keep English only */
    }
  }

  say(s, "agent", reply);
  const agentMsg = s.messages[s.messages.length - 1];
  if (replyTranslatedText) {
    agentMsg.translatedText = replyTranslatedText;
    agentMsg.translationAI = replyTranslationAI;
    agentMsg.lang = "en";
  }
  saveSession(s);
  return { session: s, reply };
}

/**
 * Seller CONFIRMS -> and ONLY then is a PayPal order created.
 * This is the guardrail that makes the agent safe: no confirm, no charge.
 */
export async function confirmSession(
  sessionId: string
): Promise<{ session: AgentSession; order: Order } | null> {
  const s = getSession(sessionId);
  if (!s || s.state !== "awaiting_seller_confirm" || !s.pendingCharge) return null;

  // Belt & braces: clamp into bounds even if something upstream went wrong
  const amount = Math.min(s.maxPrice, Math.max(s.minPrice, s.pendingCharge.amount));

  const pp = await createOrder(
    amount,
    s.currency,
    `${s.productName} (agentic sale to ${s.buyerName})`
  );
  const order: Order = {
    id: rid("order"),
    paypalOrderId: pp.id,
    pageId: s.pageId,
    productId: s.productId,
    productName: s.productName,
    amount,
    currency: s.currency,
    buyerEmail: `${s.buyerName.toLowerCase().replace(/\W+/g, "")}@buyer.example`,
    status: "CREATED",
    createdAt: new Date().toISOString(),
  };
  saveOrder(order);

  s.state = "confirmed";
  s.orderId = order.id;
  pushStep(
    s,
    `Seller confirmed the ${amount} ${s.currency} deal. Creating the PayPal order NOW — this is the first and only point where money moves.`,
    `created PayPal order ${pp.id} for ${amount} ${s.currency}`
  );
  say(
    s,
    "agent",
    `Great news ${s.buyerName}! The seller approved ${amount} ${s.currency}. Your PayPal checkout is ready — order ${pp.id}.`
  );
  saveSession(s);
  return { session: s, order };
}

export function declineSession(sessionId: string): AgentSession | null {
  const s = getSession(sessionId);
  if (!s || s.state === "completed" || s.state === "confirmed") return null;
  s.state = "declined";
  s.pendingCharge = null;
  pushStep(s, "Seller declined the deal.", "session closed, nothing charged");
  say(s, "system", "The seller declined this deal. No charge was made.");
  saveSession(s);
  return s;
}
