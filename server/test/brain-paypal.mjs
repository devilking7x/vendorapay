// Vendora Pay AI — brain + PayPal resilience tests (plain node, no deps).
// Run:  npm run build --prefix server && node server/test/brain-paypal.mjs
// Honest mocks only: no fake orders, no fake negotiations.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
}

// ---------- 1. brain factory: no key -> honest heuristic fallback ----------
delete process.env.AI_API_KEY;
delete process.env.NEBIUS_API_KEY;
delete process.env.SALES_BRAIN;

const brainMod = await import(path.join(DIST, "brain", "index.js"));
const { createSalesBrain, validateDraft } = brainMod;

console.log("— brain factory fallback —");
const b0 = createSalesBrain();
ok("no key -> heuristic brain", /Heuristic/i.test(b0.name), b0.name);
ok("heuristic honestly labeled rule-based, not AI", /rule-based — not AI/.test(b0.name), b0.name);
ok("heuristic isAI is false", b0.isAI === false);

// SALES_BRAIN=nebius with no key -> still honest heuristic fallback
process.env.SALES_BRAIN = "nebius";
const b1 = createSalesBrain();
ok("SALES_BRAIN=nebius without key -> heuristic fallback", b1.isAI === false, b1.name);
delete process.env.SALES_BRAIN;

// ---------- 2. heuristic intent classification ----------
console.log("— heuristic intent classification —");
const brain = createSalesBrain();
const ctx = {
  productName: "Logo Pack",
  sellerName: "Raza",
  buyerName: "Maya",
  currency: "USD",
  listPrice: 50,
  minPrice: 35,
  maxPrice: 50,
  history: [],
};
const cases = [
  ["I'll give you $30 for it", "price-negotiation"],
  ["yes, deal!", "ready-to-buy"],
  ["is this refundable?", "question"],
  ["this is a scam, I want my money back", "complaint"],
  ["hi there", "smalltalk"],
];
for (const [msg, want] of cases) {
  const a = await brain.analyzeBuyerMessage(msg, ctx);
  ok(`intent "${msg.slice(0, 24)}..." -> ${want}`, a.intent === want, `got ${a.intent}`);
  ok("analysis carries reasoning", typeof a.reasoning === "string" && a.reasoning.length > 20);
  ok("analysis engine honestly labeled", /rule-based — not AI/.test(a.engine), a.engine);
}

// ---------- 3. guardrail validator: brain drafts can't break bounds ----------
console.log("— guardrail validator —");
ok(
  "rejects invented price",
  validateDraft("Deal at 999 USD, my friend!", { action: "counter", amount: 40, currency: "USD" }) !== null
);
ok(
  "rejects fake charge claim",
  validateDraft("Done — 40 USD works! You've been charged.", { action: "accept", amount: 40, currency: "USD" }) !== null
);
ok(
  "rejects 'billed' claim",
  validateDraft("Great, 40 USD — billed to your card.", { action: "accept", amount: 40, currency: "USD" }) !== null
);
ok(
  "rejects multiple distinct prices",
  validateDraft("40 USD or maybe 45 USD?", { action: "counter", amount: 40, currency: "USD" }) !== null
);
ok(
  "accepts honest draft quoting decided amount",
  validateDraft("Done — 40 USD works! No payment is taken until the seller approves.", {
    action: "accept",
    amount: 40,
    currency: "USD",
  }) === null
);
ok(
  "accepts budget ask without price",
  validateDraft("What's your budget?", { action: "ask-budget", currency: "USD" }) === null
);

// heuristic draftReply itself must pass the validator for every decided action
// (using realistic base replies, as the real agent flow provides)
const decidedCases = [
  { d: { action: "counter", amount: 42, currency: "USD" }, base: "How about 42 USD?" },
  { d: { action: "accept", amount: 40, currency: "USD" }, base: "Done — 40 USD works!" },
  { d: { action: "cap-at-ceiling", amount: 50, currency: "USD" }, base: "The most I can accept is the listed 50 USD." },
  { d: { action: "ask-budget", currency: "USD" }, base: "What's your budget?" },
  { d: { action: "clarify", amount: 50, currency: "USD" }, base: "Are you agreeing to 50 USD (the listed price)?" },
];
for (const { d, base } of decidedCases) {
  const analysis = await brain.analyzeBuyerMessage("I'll pay $30", ctx);
  const draft = await brain.draftReply(analysis, ctx, d, base);
  const rej = validateDraft(draft.text, d);
  ok(`heuristic draft passes validator (action=${d.action})`, rej === null, rej ?? "");
}

// ---------- 4. PayPal retry: transient failures then success ----------
console.log("— PayPal retry on transient failures —");
process.env.PAYPAL_MOCK = "0";
process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";
process.env.PAYPAL_RETRY_DELAYS_MS = "5,5,5"; // fast retries for tests

let orderCalls = 0;
let orderFailuresLeft = 2;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/v1/oauth2/token")) {
    return new Response(JSON.stringify({ access_token: "TEST-TOKEN" }), { status: 200 });
  }
  if (u.includes("/v2/checkout/orders") && !u.includes("/capture")) {
    orderCalls++;
    if (orderFailuresLeft > 0) {
      orderFailuresLeft--;
      return new Response("Service Unavailable", { status: 503 });
    }
    return new Response(
      JSON.stringify({ id: "RETRY-ORDER-1", status: "CREATED", links: [] }),
      { status: 200 }
    );
  }
  return new Response("not found", { status: 404 });
};

const paypal = await import(path.join(DIST, "paypal.js"));
paypal.resetPayPalCircuit();

const order = await paypal.createOrder(40, "USD", "retry test");
ok("retry succeeds after transient 503s", order.id === "RETRY-ORDER-1", order.id);
ok("order endpoint hit 3 times (1 + 2 retries)", orderCalls === 3, `got ${orderCalls}`);
ok("success path unchanged (id/status/amount)", order.status === "CREATED" && order.amount === 40);

// ---------- 5. circuit breaker: persistent failure -> honest error, no fake order ----------
console.log("— circuit breaker —");
paypal.resetPayPalCircuit();
orderCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/v1/oauth2/token")) {
    return new Response(JSON.stringify({ access_token: "TEST-TOKEN" }), { status: 200 });
  }
  if (u.includes("/v2/checkout/orders")) {
    orderCalls++;
    return new Response("Internal Server Error", { status: 500 });
  }
  return new Response("not found", { status: 404 });
};

let honestErr = null;
try {
  await paypal.createOrder(10, "USD", "breaker test");
} catch (e) {
  honestErr = e;
}
ok("persistent failure throws (no fake order)", honestErr !== null);
ok(
  "error is honest about no charge",
  honestErr && /nothing was charged/i.test(honestErr.message),
  honestErr?.message?.slice(0, 80)
);
ok("error names PayPalError", honestErr?.name === "PayPalError", honestErr?.name);

// trip the breaker: 5 consecutive failed operations
for (let i = 0; i < 4; i++) {
  try {
    await paypal.createOrder(10, "USD", "breaker test");
  } catch { /* expected */ }
}
const callsBefore = orderCalls;
let circuitErr = null;
try {
  await paypal.createOrder(10, "USD", "breaker test");
} catch (e) {
  circuitErr = e;
}
ok("circuit opens after repeated failures", circuitErr && /circuit breaker OPEN/i.test(circuitErr.message), circuitErr?.message?.slice(0, 80));
ok("open circuit fails fast without network calls", orderCalls === callsBefore, `calls ${callsBefore} -> ${orderCalls}`);

// reset works
paypal.resetPayPalCircuit();
let afterResetErr = null;
try {
  await paypal.createOrder(10, "USD", "breaker test");
} catch (e) {
  afterResetErr = e;
}
ok("circuit reset allows calls again", afterResetErr && !/circuit breaker OPEN/i.test(afterResetErr.message));

globalThis.fetch = realFetch;

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("failures:", failures.join(", "));
  process.exit(1);
}
