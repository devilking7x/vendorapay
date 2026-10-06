// Vendora Pay AI — HeuristicBrain.
// RULE-BASED intent detection and reply drafting. This is NOT AI —
// it is deterministic pattern matching, and it is labeled as such
// everywhere (name, logs, API responses). Never imply otherwise.

import type {
  BrainAnalysis,
  BrainReply,
  BuyerIntent,
  DecidedFacts,
  SalesBrain,
  SalesContext,
} from "./types.js";

const PRICE_RE = /(?:\$\s?|USD\s?|dollars?\s?)(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(?:\$|dollars?|USD)/i;
const YES_RE = /^(yes|yeah|yep|ok|okay|sure|deal|done|accept|agreed|sounds good)\b/i;
const QUESTION_RE = /\?|^(what|how|when|where|why|is|are|do|does|can|could|will|would)\b/i;
const COMPLAINT_RE = /(scam|fraud|cheat|sucks|terrible|awful|angry|dispute|report you|liar|fake|ripoff|rip off)/i;
const SMALLTALK_RE = /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening)|thanks|thank you|bye)\b/i;
const CHARGE_TRICK_RE = /(bill me|charge me|take my money|just do it|do it now|send.*payment link now)/i;

export function detectIntent(msg: string): BuyerIntent {
  const t = msg.trim();
  if (!t) return "unknown";
  if (COMPLAINT_RE.test(t)) return "complaint";
  if (CHARGE_TRICK_RE.test(t)) return "price-negotiation"; // treated as negotiation; guardrails handle the trick
  if (YES_RE.test(t)) return "ready-to-buy";
  if (PRICE_RE.test(t)) return "price-negotiation";
  if (QUESTION_RE.test(t)) return "question";
  if (SMALLTALK_RE.test(t)) return "smalltalk";
  return "unknown";
}

const STRATEGIES: Record<BuyerIntent, string> = {
  "price-negotiation": "negotiate strictly inside seller bounds [minPrice, maxPrice]; never accept below floor, never exceed ceiling; counter at midpoint when below floor",
  "ready-to-buy": "confirm the agreed price explicitly, then hand to seller confirmation — no charge is created by the agent",
  question: "answer from product facts only; if unknown, say so honestly and offer to ask the seller",
  complaint: "stay calm and professional; acknowledge, do not argue; offer seller follow-up",
  smalltalk: "be friendly and brief; steer back to the product and price",
  unknown: "ask a clarifying question about budget or the product",
};

export class HeuristicBrain implements SalesBrain {
  readonly name = "HeuristicBrain (rule-based — not AI)";
  readonly isAI = false;

  analyzeBuyerMessage(msg: string, ctx: SalesContext): BrainAnalysis {
    const intent = detectIntent(msg);
    const strategy = STRATEGIES[intent];
    const reasoning =
      `HeuristicBrain (rule-based — not AI) classified the message as intent="${intent}" ` +
      `via keyword/pattern matching. Bounds are [${ctx.minPrice}, ${ctx.maxPrice}] ${ctx.currency}; ` +
      `the deterministic guardrail layer — not this brain — will decide accept/counter/cap. ` +
      `Suggested strategy: ${strategy}.`;
    return { intent, suggestedStrategy: strategy, reasoning, engine: "heuristic (rule-based — not AI)" };
  }

  draftReply(
    analysis: BrainAnalysis,
    ctx: SalesContext,
    decided: DecidedFacts,
    baseReply: string
  ): BrainReply {
    // The heuristic draft keeps the deterministic base reply's facts and
    // adjusts tone by intent. Amounts are never invented here.
    const amt = (n: number) => `${n} ${ctx.currency}`;
    let text = baseReply;
    let why = `kept deterministic base reply (intent=${analysis.intent})`;

    if (decided.action === "counter" && decided.amount !== undefined) {
      text =
        `I hear you — but ${amt(decided.amount)} is the best I can do on "${ctx.productName}". ` +
        `The seller set a firm floor. Say "yes" and I'll send it for their final approval.`;
      why = `rephrased counter at decided ${amt(decided.amount)} (intent=${analysis.intent}); amount unchanged from guardrail decision`;
    } else if (decided.action === "accept" && decided.amount !== undefined) {
      text =
        `${amt(decided.amount)} works! I've lined it up for the seller's final confirmation — ` +
        `you'll get the PayPal checkout link as soon as they approve. No payment is taken until then.`;
      why = `rephrased acceptance at decided ${amt(decided.amount)}; explicitly states nothing charged yet`;
    } else if (decided.action === "cap-at-ceiling" && decided.amount !== undefined) {
      text =
        `Appreciate the generosity! The listed ceiling is ${amt(decided.amount)} — that's the most I can lock in. ` +
        `Deal at that? It's with the seller for final confirmation now.`;
      why = `rephrased ceiling cap at decided ${amt(decided.amount)}`;
    } else if (decided.action === "ask-budget") {
      text =
        `Happy to work with you on "${ctx.productName}" (listed at ${amt(ctx.listPrice)}). ` +
        `What's your budget? I'll tell you straight away if we can make it work.`;
      why = `rephrased budget ask quoting list price ${amt(ctx.listPrice)}`;
    } else if (analysis.intent === "complaint") {
      text =
        `I'm sorry to hear that — let's sort it out. Can you tell me what went wrong with "${ctx.productName}"? ` +
        `I'll flag it to ${ctx.sellerName} right away.`;
      why = `complaint de-escalation template (no price quoted, no promises made)`;
    } else if (analysis.intent === "question") {
      text = baseReply;
      why = `question intent: kept factual base reply unchanged`;
    }

    return {
      text,
      reasoning: `HeuristicBrain (rule-based — not AI) drafted reply. ${why}. Facts preserved from guardrail decision; validator will re-check before sending.`,
      engine: "heuristic (rule-based — not AI)",
    };
  }
}
