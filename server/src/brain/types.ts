// Vendora Pay AI — SalesBrain interface.
// The brain PROPOSES strategy and reply phrasing; hard guardrails
// (price bounds, seller-confirmation-before-charge) are enforced OUTSIDE
// the brain in agent.ts. Brain proposes, guardrails dispose.

export type BuyerIntent =
  | "question"
  | "price-negotiation"
  | "ready-to-buy"
  | "complaint"
  | "smalltalk"
  | "upsell-opportunity"
  | "unknown";

/** Facts the brain may use. Amounts are decided OUTSIDE the brain. */
export interface SalesContext {
  productName: string;
  sellerName: string;
  buyerName: string;
  currency: string;
  listPrice: number;
  minPrice: number;
  maxPrice: number;
  /** agent's last counter offer, if any */
  lastAgentOffer?: number;
  /** recent message history, newest last, truncated */
  history: string[];
}

export interface BrainAnalysis {
  intent: BuyerIntent;
  suggestedStrategy: string;
  /** human-readable reasoning trace — always present */
  reasoning: string;
  /** what actually produced THIS output, e.g. "nebius" or "heuristic (rule-based — not AI)" */
  engine: string;
}

export interface BrainReply {
  text: string;
  /** human-readable reasoning trace — always present */
  reasoning: string;
  /** what actually produced THIS output */
  engine: string;
}

/** Facts the deterministic outcome decided; the draft must honor them. */
export interface DecidedFacts {
  /** e.g. "counter" | "accept" | "cap-at-ceiling" | "ask-budget" | "clarify" | "waiting" */
  action: string;
  /** the ONE price the reply may quote, if any */
  amount?: number;
  currency: string;
}

export interface SalesBrain {
  /** Honest display name, e.g. "HeuristicBrain (rule-based — not AI)" */
  readonly name: string;
  /** true ONLY when a real LLM API call produced the output */
  readonly isAI: boolean;
  analyzeBuyerMessage(msg: string, ctx: SalesContext): BrainAnalysis | Promise<BrainAnalysis>;
  draftReply(
    analysis: BrainAnalysis,
    ctx: SalesContext,
    decided: DecidedFacts,
    baseReply: string
  ): BrainReply | Promise<BrainReply>;
}

/**
 * Guardrail validator for brain-drafted replies. Runs OUTSIDE the brain.
 * Rejects drafts that:
 *  - quote a price number different from the decided amount (no invented prices)
 *  - claim a charge/payment already happened (no fake charge claims)
 * Returns null when the draft is acceptable, else the rejection reason.
 */
export function validateDraft(draft: string, decided: DecidedFacts): string | null {
  const text = draft.trim();
  if (!text) return "empty draft";
  if (text.length > 600) return "draft too long";

  // No fake charge claims — money only moves after seller confirmation.
  if (/(charg(?:ed|ing)|billed|payment\s+(?:complete|successful|received|done)|order\s+(?:placed|confirmed)|you(?:'ve| have) been charged)/i.test(text)) {
    return "draft claims a charge/payment happened";
  }

  // Price numbers in the draft must match the decided amount (when one exists).
  const nums = Array.from(text.matchAll(/\$?\s?(\d+(?:\.\d{1,2})?)/g))
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (decided.amount !== undefined) {
    const matches = nums.some((n) => Math.abs(n - decided.amount!) < 0.005);
    if (!matches) return `draft does not quote the decided amount ${decided.amount}`;
    // Any second, different price-like number is suspicious — reject.
    const distinct = [...new Set(nums.map((n) => Math.round(n * 100)))];
    if (distinct.length > 1) return "draft quotes more than one distinct price";
  }
  return null;
}
