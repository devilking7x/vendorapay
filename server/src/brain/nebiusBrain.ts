// Vendora Pay AI — NebiusBrain.
// Real LLM reasoning via the existing Nebius/OpenAI-compatible client.
// Honesty contract: the per-output `engine` field names the provider ONLY
// when a real API call succeeded for THAT output. On any failure the brain
// falls back to the rule-based HeuristicBrain and says so in the reasoning.

import { aiChatJSON, AI_PROVIDER } from "../ai.js";
import { HeuristicBrain } from "./heuristicBrain.js";
import type {
  BrainAnalysis,
  BrainReply,
  BuyerIntent,
  DecidedFacts,
  SalesBrain,
  SalesContext,
} from "./types.js";

const INTENTS: BuyerIntent[] = [
  "question",
  "price-negotiation",
  "ready-to-buy",
  "complaint",
  "smalltalk",
  "unknown",
];

const FALLBACK_ENGINE = "heuristic-fallback (rule-based — not AI)";

export class NebiusBrain implements SalesBrain {
  readonly name = `NebiusBrain (${AI_PROVIDER} LLM, heuristic fallback)`;
  /** Capable of real AI — but each output's `engine` states what actually produced it. */
  readonly isAI = true;
  private fallback = new HeuristicBrain();

  private ctxSummary(ctx: SalesContext): string {
    return (
      `Product "${ctx.productName}" listed at ${ctx.listPrice} ${ctx.currency}, ` +
      `negotiation bounds [${ctx.minPrice}, ${ctx.maxPrice}] ${ctx.currency}, ` +
      `seller ${ctx.sellerName}, buyer ${ctx.buyerName}.`
    );
  }

  async analyzeBuyerMessage(msg: string, ctx: SalesContext): Promise<BrainAnalysis> {
    const r = await aiChatJSON<{
      intent?: string;
      suggestedStrategy?: string;
      reasoning?: string;
    }>(
      `You classify buyer messages for a sales agent. Context: ${this.ctxSummary(ctx)}\n` +
        `Buyer message: "${msg.slice(0, 300)}"\n` +
        `Return ONLY JSON: {"intent":"one of ${INTENTS.join("|")}",` +
        `"suggestedStrategy":"one-line negotiation strategy within the seller bounds",` +
        `"reasoning":"why you chose this intent"}. ` +
        `Never suggest exceeding the bounds or charging without seller confirmation.`,
      { maxTokens: 300, temperature: 0.2, timeoutMs: 12000 }
    );
    if (r?.data && typeof r.data.intent === "string" && (INTENTS as string[]).includes(r.data.intent)) {
      const intent = r.data.intent as BuyerIntent;
      return {
        intent,
        suggestedStrategy: String(r.data.suggestedStrategy ?? "").slice(0, 300),
        reasoning: `[real ${r.engine} LLM call] ${String(r.data.reasoning ?? "intent classified by LLM").slice(0, 400)}`,
        engine: r.engine,
      };
    }
    const fb = this.fallback.analyzeBuyerMessage(msg, ctx);
    return {
      ...fb,
      reasoning: `NebiusBrain: LLM call failed or returned unusable output — fell back to rule-based analysis. ${fb.reasoning}`,
      engine: FALLBACK_ENGINE,
    };
  }

  async draftReply(
    analysis: BrainAnalysis,
    ctx: SalesContext,
    decided: DecidedFacts,
    baseReply: string
  ): Promise<BrainReply> {
    const amountLine =
      decided.amount !== undefined
        ? `The reply MUST quote exactly ${decided.amount} ${decided.currency} and no other price.`
        : `The reply must not quote any price.`;
    const r = await aiChatJSON<{ text?: string; reasoning?: string }>(
      `You write sales replies. Context: ${this.ctxSummary(ctx)}\n` +
        `Buyer intent: ${analysis.intent}. Decided action: ${decided.action}. ${amountLine}\n` +
        `Base reply (facts already correct): "${baseReply.slice(0, 400)}"\n` +
        `Rewrite it warmly in ≤3 sentences for the buyer "${ctx.buyerName}". ` +
        `HARD RULES: never claim anything was charged or paid (the seller confirms first); ` +
        `never invent prices; never promise seller approval. ` +
        `Return ONLY JSON: {"text":"...","reasoning":"why you phrased it this way"}.`,
      { maxTokens: 300, temperature: 0.7, timeoutMs: 12000 }
    );
    if (r?.data?.text && r.data.text.trim().length > 0) {
      return {
        text: r.data.text.trim().slice(0, 600),
        reasoning: `[real ${r.engine} LLM call] ${String(r.data.reasoning ?? "reply drafted by LLM").slice(0, 400)}`,
        engine: r.engine,
      };
    }
    const fb = this.fallback.draftReply(analysis, ctx, decided, baseReply);
    return {
      ...fb,
      reasoning: `NebiusBrain: LLM call failed or returned unusable output — fell back to rule-based draft. ${fb.reasoning}`,
      engine: FALLBACK_ENGINE,
    };
  }
}
