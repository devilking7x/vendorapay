// Vendora Pay AI — brain factory.
// Picks the reasoning core for the agentic salesperson.
// SALES_BRAIN env override: "auto" (default) | "heuristic" | "nebius".
// "auto": real LLM brain when an AI key is configured, else honest rule-based.

import { aiMode, AI_PROVIDER } from "../ai.js";
import { HeuristicBrain } from "./heuristicBrain.js";
import { NebiusBrain } from "./nebiusBrain.js";
import type { SalesBrain } from "./types.js";

export type BrainMode = "auto" | "heuristic" | "nebius";

function configuredMode(): BrainMode {
  const m = (process.env.SALES_BRAIN ?? "auto").toLowerCase();
  if (m === "heuristic" || m === "nebius") return m;
  return "auto";
}

export function createSalesBrain(): SalesBrain {
  const mode = configuredMode();
  if ((mode === "auto" || mode === "nebius") && aiMode() !== "template") {
    console.log(`[brain] AI key present (provider: ${AI_PROVIDER}) — NebiusBrain active (heuristic fallback on LLM failure)`);
    return new NebiusBrain();
  }
  if (mode === "nebius") {
    console.log("[brain] SALES_BRAIN=nebius but no AI key — falling back to HeuristicBrain (rule-based — not AI)");
  } else {
    console.log("[brain] no AI key — HeuristicBrain (rule-based — not AI) active");
  }
  return new HeuristicBrain();
}

export type { SalesBrain };
export type {
  BrainAnalysis,
  BrainReply,
  BuyerIntent,
  DecidedFacts,
  SalesContext,
} from "./types.js";
export { validateDraft } from "./types.js";
