// Vendora Pay AI — Abandoned Cart Recovery.
// Tracks PayPal orders that were CREATED but never CAPTURED, and lets the
// seller send a one-time, message-only nudge. GUARDRAIL: a nudge is NEVER
// a charge — it is text only. Max 1 nudge per cart (no spam).

import { aiChatJSON, aiMode } from "./ai.js";
import {
  getOrder,
  getPage,
  listAbandonedCarts as storeList,
  listOrders,
  saveAbandonedCart,
  saveCoupon,
  setAbandonedNudged,
  setAbandonedRecovered,
  rid,
  type AbandonedCart,
  type Page,
} from "./store.js";

export type { AbandonedCart };

/** Default: 30 minutes. Overridable via RECOVERY_TIMEOUT_MS (tests use this). */
export function abandonmentTimeoutMs(): number {
  const v = Number(process.env.RECOVERY_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 30 * 60 * 1000;
}

/**
 * Scan all CREATED orders; any older than the timeout becomes an
 * abandoned cart (idempotent — already-tracked orders are skipped).
 * Returns the number of newly marked carts.
 */
export function sweepAbandoned(): number {
  const cutoff = Date.now() - abandonmentTimeoutMs();
  let fresh = 0;
  for (const o of listOrders()) {
    if (o.status !== "CREATED") continue;
    if (storeList().some((c) => c.orderId === o.id)) continue;
    if (new Date(o.createdAt).getTime() > cutoff) continue;
    const cart: AbandonedCart = {
      id: rid("cart"),
      orderId: o.id,
      pageId: o.pageId,
      productId: o.productId,
      productName: o.productName,
      amount: o.amount,
      currency: o.currency,
      buyerEmail: o.buyerEmail,
      createdAt: o.createdAt,
      abandonedAt: new Date().toISOString(),
      nudged: false,
      recovered: false,
    };
    saveAbandonedCart(cart);
    fresh++;
  }
  return fresh;
}

export function getAbandonedCarts(pageId: string): AbandonedCart[] {
  sweepAbandoned(); // lazy sweep keeps the list fresh without a timer
  return storeList(pageId);
}

export function recoveryStats(pageId: string): {
  abandoned: number;
  nudged: number;
  recovered: number;
  recoveryRate: number;
} {
  const carts = getAbandonedCarts(pageId);
  const recovered = carts.filter((c) => c.recovered).length;
  const nudged = carts.filter((c) => c.nudged).length;
  return {
    abandoned: carts.length,
    nudged,
    recovered,
    recoveryRate:
      carts.length > 0 ? Math.round((recovered / carts.length) * 1000) / 10 : 0,
  };
}

/** Mark a cart recovered when its order is later captured. Called from the capture endpoint. */
export function markRecoveredByOrderId(orderId: string): void {
  setAbandonedRecovered(orderId, true);
}

async function rephraseWithAI(text: string): Promise<{ text: string; ai: boolean }> {
  if (aiMode() === "template") return { text, ai: false };
  try {
    const r = await aiChatJSON<{ message: string }>(
      `Rephrase this abandoned-cart nudge warmly and briefly (under 280 chars). Keep the price, product name and any coupon code EXACTLY as-is. Reply with ONLY JSON: {"message": "..."}\n\nNudge: ${text}`,
      { maxTokens: 300, temperature: 0.7, timeoutMs: 12000 }
    );
    if (r?.data?.message) return { text: r.data.message, ai: true };
  } catch {
    /* fall through */
  }
  return { text, ai: false };
}

/**
 * Build the nudge message for a cart. If the seller enabled a recovery
 * sweetener in page settings, a REAL single-use coupon is created and
 * included. Otherwise it's just a friendly reminder. Never a charge.
 */
export async function generateRecoveryMessage(
  cart: AbandonedCart,
  page: Page
): Promise<{ message: string; aiRephrased: boolean; couponCode?: string }> {
  const firstName = cart.buyerEmail.split("@")[0] || "there";
  let couponCode: string | undefined;
  let sweetener = "";

  const settings = page.recoverySettings;
  if (settings?.enabled && settings.discountPercent && settings.discountPercent > 0) {
    const pct = Math.min(30, Math.max(1, Math.round(settings.discountPercent)));
    couponCode = `COMEBACK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    saveCoupon({
      code: couponCode,
      pageId: page.id,
      percentOff: pct,
      maxUses: 1,
      usedCount: 0,
      createdAt: new Date().toISOString(),
    });
    sweetener = ` Here's ${pct}% off to make it easy — use code ${couponCode} at checkout (one-time, 24h).`;
  }

  const base =
    `Hi ${firstName}! You left "${cart.productName}" (${cart.amount} ${cart.currency}) in your cart. ` +
    `It's still waiting for you — complete your checkout whenever you're ready.${sweetener}`;

  const { text, ai } = await rephraseWithAI(base);
  return { message: text, aiRephrased: ai, couponCode };
}

/**
 * Seller triggers the follow-up. Message-only — NEVER charges.
 * Max 1 nudge per cart. In demo mode the message is logged, not sent
 * through a real channel (labeled honestly in the response).
 */
export async function nudgeCart(orderId: string): Promise<{
  message: string;
  aiRephrased: boolean;
  couponCode?: string;
  sent: boolean;
  note: string;
} | null> {
  sweepAbandoned(); // ensure recently-abandoned orders are tracked before nudging
  const cart = storeList().find((c) => c.orderId === orderId);
  if (!cart || cart.nudged) return null; // max 1 nudge — no spam
  const page = getPage(cart.pageId);
  if (!page) return null;

  const { message, aiRephrased, couponCode } = await generateRecoveryMessage(cart, page);
  setAbandonedNudged(orderId, true, message);

  // Demo mode: we have no SMS/email infra — log honestly instead of sending.
  console.log(`[recovery] NUDGE (demo — logged, not sent via real channel) for order ${orderId}: ${message}`);
  return {
    message,
    aiRephrased,
    couponCode,
    sent: false,
    note: "demo mode — nudge logged, not sent through a real messaging channel",
  };
}
