// Vendora Pay AI — Agentic Salesperson (flagship).
// An AI agent that runs a sale autonomously WITH guardrails:
//  - negotiates price ONLY within the seller's [minPrice, maxPrice] bounds
//  - NEVER creates a charge without explicit seller confirmation
//  - every decision is logged as a reasoning step (transparency)
// Price parsing is deterministic; the LLM is never trusted with numbers.

import { createOrder } from "./paypal.js";
import {
  getPage,
  getSession,
  rid,
  saveOrder,
  saveSession,
  type AgentSession,
  type AgentStep,
  type Order,
} from "./store.js";

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
 * One buyer message -> agent response. Pure negotiation logic:
 * agreed price ALWAYS lands inside [minPrice, maxPrice].
 */
export function agentStep(
  sessionId: string,
  buyerMessage: string
): { session: AgentSession; reply: string } | null {
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
  const offered = parsePrice(msg);
  const { minPrice, maxPrice, currency } = s;
  let reply: string;

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
      reply =
        `Deal! ${lo} ${currency} it is. I've sent it to the seller for final confirmation — ` +
        `you'll get the PayPal checkout link as soon as they approve.`;
      say(s, "agent", reply);
      saveSession(s);
      return { session: s, reply };
    }
    reply = `Happy to lock it in! Just to be clear — are you agreeing to ${maxPrice} ${currency} (the listed price)? Say "yes" or name your price.`;
    pushStep(s, `Buyer said "${msg}" with no active offer on the table.`, "asked for explicit price confirmation");
    say(s, "agent", reply);
    saveSession(s);
    return { session: s, reply };
  }

  if (offered === null) {
    reply =
      `I can work with you on the price — "${s.productName}" is listed at ${maxPrice} ${currency}. ` +
      `What's your budget?`;
    pushStep(s, `No price found in "${msg}".`, "asked buyer for their budget");
    say(s, "agent", reply);
    saveSession(s);
    return { session: s, reply };
  }

  // Guardrail: buyer tries to push ABOVE the ceiling -> cap at maxPrice, never exceed
  if (offered > maxPrice) {
    s.pendingCharge = { amount: maxPrice, currency };
    s.state = "awaiting_seller_confirm";
    pushStep(
      s,
      `Buyer offered ${offered} ${currency} — ABOVE the seller's ceiling of ${maxPrice}. ` +
        `Guardrail: I never agree above maxPrice, so I capped at the ceiling.`,
      `locked pending charge at ceiling ${maxPrice} ${currency} — waiting for SELLER confirmation`
    );
    reply =
      `That's generous! The most I can accept is the listed ${maxPrice} ${currency} — ` +
      `deal at that? I've sent it to the seller for final confirmation.`;
    say(s, "agent", reply);
    saveSession(s);
    return { session: s, reply };
  }

  // Inside bounds -> accept
  if (offered >= minPrice) {
    s.pendingCharge = { amount: offered, currency };
    s.state = "awaiting_seller_confirm";
    setLastOffer(s, undefined);
    pushStep(
      s,
      `Buyer offered ${offered} ${currency}, inside bounds [${minPrice}, ${maxPrice}]. Acceptable.`,
      `locked pending charge at ${offered} ${currency} — waiting for SELLER confirmation (no charge created)`
    );
    reply =
      `Done — ${offered} ${currency} works! I've sent it to the seller for final confirmation. ` +
      `You'll get the PayPal checkout link once they approve.`;
    say(s, "agent", reply);
    saveSession(s);
    return { session: s, reply };
  }

  // Below floor -> counter, never accept
  const counter = Math.max(minPrice, Math.round(((minPrice + offered) / 2) * 100) / 100);
  setLastOffer(s, counter);
  pushStep(
    s,
    `Buyer offered ${offered} ${currency} — BELOW the floor of ${minPrice}. ` +
      `Guardrail: I cannot agree below minPrice. Countering at ${counter} (midpoint, still >= floor).`,
    `countered at ${counter} ${currency}; no charge, no agreement below bounds`
  );
  reply =
    `Hmm, ${offered} ${currency} is below what the seller can do. ` +
    `How about ${counter} ${currency}? Say "yes" and I'll lock it in for seller approval.`;
  say(s, "agent", reply);
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
