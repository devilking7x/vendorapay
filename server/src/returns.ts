// Vendora Pay AI — Return / Refund Agent.
// Buyers can request a return; the agent drafts a summary + recommendation
// for the seller; the SELLER decides. GUARDRAIL: a refund is NEVER issued
// without explicit seller approval — same hard-constraint pattern as the
// charge guardrail in agent.ts. Refunds go through the real PayPal Refunds
// API with the standard retry logic; failures are honest, never faked.

import { aiChatJSON, aiMode, AI_PROVIDER } from "./ai.js";
import {
  findReturnByOrder,
  getOrder,
  getPage,
  getReturn,
  listReturns,
  saveReturn,
  rid,
  type Order,
  type ReturnRequest,
} from "./store.js";
import {
  getCaptureIdForOrder,
  refundCapture,
  PayPalError,
} from "./paypal.js";

export type { ReturnRequest };

/** Default return window in days when the page doesn't set one. */
export const DEFAULT_RETURN_WINDOW_DAYS = 7;

export function returnWindowDays(pageId: string): number {
  const p = getPage(pageId);
  const w = p?.returnWindowDays;
  return typeof w === "number" && w >= 0 ? w : DEFAULT_RETURN_WINDOW_DAYS;
}

export interface ReturnOutcome {
  ok: boolean;
  return?: ReturnRequest;
  /** honest machine-readable error */
  error?: string;
}

/**
 * Buyer initiates a return. Validates: order exists, is captured/completed,
 * no open return already, and within the seller's return window.
 */
export function requestReturn(
  orderId: string,
  reason: string
): ReturnOutcome {
  const order: Order | null = getOrder(orderId);
  if (!order) return { ok: false, error: "order not found" };
  if (order.status !== "CAPTURED" && order.status !== "COMPLETED") {
    return {
      ok: false,
      error: `order is ${order.status} — only captured/completed orders can be returned`,
    };
  }
  const existing = findReturnByOrder(orderId);
  if (existing) {
    return { ok: false, error: `a return is already ${existing.status.toLowerCase()} for this order` };
  }
  const windowDays = returnWindowDays(order.pageId);
  const ageDays =
    (Date.now() - new Date(order.createdAt).getTime()) / 864e5;
  if (ageDays > windowDays) {
    return {
      ok: false,
      error: `return window expired — this seller accepts returns within ${windowDays} days (order is ${Math.floor(ageDays)} days old)`,
    };
  }
  const cleanReason = reason.trim().slice(0, 500);
  if (!cleanReason) return { ok: false, error: "a reason is required" };
  const r: ReturnRequest = {
    id: rid("ret"),
    orderId: order.id,
    paypalOrderId: order.paypalOrderId,
    pageId: order.pageId,
    productId: order.productId,
    productName: order.productName,
    amount: order.amount,
    currency: order.currency,
    buyerEmail: order.buyerEmail,
    reason: cleanReason,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  saveReturn(r);
  return { ok: true, return: r };
}

/**
 * Agent drafts a summary + recommendation for the seller.
 * AI when a key is set, honest rule-based fallback otherwise.
 */
export async function summarizeForSeller(
  returnId: string
): Promise<ReturnRequest | null> {
  const r = getReturn(returnId);
  if (!r) return null;
  const page = getPage(r.pageId);
  const sellerName = page?.sellerName ?? "seller";
  const windowDays = returnWindowDays(r.pageId);
  const ageDays = Math.floor(
    (Date.now() - new Date(r.createdAt).getTime()) / 864e5
  );

  let summary: string;
  let recommendation: "approve" | "decline";
  let engine: string;

  if (aiMode() !== "template") {
    try {
      const ai = await aiChatJSON<{ summary?: string; recommendation?: string }>(
        `You are a returns assistant for an online seller "${sellerName}". ` +
          `Buyer ${r.buyerEmail} wants to return "${r.productName}" (${r.amount} ${r.currency}). ` +
          `Reason: "${r.reason}". Order age: ${ageDays} days (return window: ${windowDays} days). ` +
          `Draft a 2-3 sentence neutral summary for the seller and a recommendation ("approve" or "decline") with one-line reasoning. ` +
          `Return ONLY JSON: {"summary":"...","recommendation":"approve|decline"}.`,
        { maxTokens: 400, temperature: 0.4, timeoutMs: 15000 }
      );
      if (ai?.data?.summary) {
        summary = ai.data.summary.slice(0, 600);
        recommendation = ai.data.recommendation === "decline" ? "decline" : "approve";
        engine = ai.engine;
      } else {
        throw new Error("no ai summary");
      }
    } catch {
      ({ summary, recommendation, engine } = templateSummary(r, ageDays, windowDays));
    }
  } else {
    ({ summary, recommendation, engine } = templateSummary(r, ageDays, windowDays));
  }

  r.agentSummary = summary;
  r.agentRecommendation = recommendation;
  r.agentEngine = engine;
  saveReturn(r);
  return r;
}

function templateSummary(
  r: ReturnRequest,
  ageDays: number,
  windowDays: number
): { summary: string; recommendation: "approve" | "decline"; engine: string } {
  const reason = r.reason.toLowerCase();
  // Heuristic signals for declining: buyer admits fault / changed mind late.
  const declineSignals = ["changed my mind", "don't need", "dont need", "found cheaper", "ordered by mistake"];
  const decline = declineSignals.some((s) => reason.includes(s)) && ageDays > windowDays / 2;
  const recommendation = decline ? "decline" : "approve";
  const summary =
    `Return request for "${r.productName}" (${r.amount} ${r.currency}) from ${r.buyerEmail}. ` +
    `Reason: "${r.reason.slice(0, 160)}". Order is ${ageDays} day(s) old (window: ${windowDays} days). ` +
    (decline
      ? "Signal: buyer-side reason late in the window — declining is defensible, but goodwill matters."
      : "Within policy — approving keeps the buyer relationship healthy.");
  return { summary, recommendation, engine: "template (rule-based — not AI)" };
}

export interface DecideOutcome {
  ok: boolean;
  return?: ReturnRequest;
  error?: string;
}

/**
 * Seller decides a return. APPROVAL IS THE HARD GUARDRAIL: nothing is
 * refunded unless the seller explicitly approves. On approval the real
 * PayPal Refunds API is called (with retry); on failure the return is
 * marked FAILED with the honest error — never a fake success.
 */
export async function decideReturn(
  returnId: string,
  approved: boolean,
  sellerNote?: string
): Promise<DecideOutcome> {
  const r = getReturn(returnId);
  if (!r) return { ok: false, error: "return not found" };
  if (r.status !== "PENDING") {
    return { ok: false, error: `return is already ${r.status.toLowerCase()}` };
  }
  const note = (sellerNote ?? "").trim().slice(0, 500);
  if (!approved) {
    r.status = "DECLINED";
    r.decidedAt = new Date().toISOString();
    if (note) r.sellerNote = note;
    saveReturn(r);
    return { ok: true, return: r };
  }
  // Approved -> process the real PayPal refund.
  r.status = "APPROVED";
  r.decidedAt = new Date().toISOString();
  if (note) r.sellerNote = note;
  saveReturn(r);
  try {
    const captureId = await getCaptureIdForOrder(r.paypalOrderId);
    if (!captureId) {
      throw new PayPalError("no completed PayPal capture found for this order — nothing to refund");
    }
    const refund = await refundCapture(captureId, r.amount, r.currency);
    r.status = "REFUNDED";
    r.paypalRefundId = refund.id;
    saveReturn(r);
    return { ok: true, return: r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r.status = "FAILED";
    r.refundError = msg.slice(0, 300);
    saveReturn(r);
    return {
      ok: false,
      error: `refund failed: ${msg.slice(0, 200)} — buyer was NOT charged again, no money moved`,
      return: r,
    };
  }
}

export function listPageReturns(pageId: string): ReturnRequest[] {
  return listReturns(pageId);
}
