// Vendora Pay AI — mock-mode E2E test (plain node, no deps).
// Spawns the built server with PAYPAL_MOCK=1, runs API assertions, exits 0/1.
// Run:  npm run build --prefix server && node server/test/e2e.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 4311;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function req(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitForHealth(srv) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("server did not start");
  srv.kill();
  process.exit(1);
}

async function main() {
  const srv = spawn("node", [path.join(ROOT, "dist/index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PAYPAL_MOCK: "1",
      VENDORA_DATA_FILE: "/tmp/vendorapay-e2e.json",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", () => {});
  srv.stderr.on("data", () => {});
  process.on("exit", () => srv.kill());

  try {
    console.log("— health —");
    const h = await waitForHealth(srv);
    ok("health ok", h.ok === true);
    ok("paypal mode is mock", h.paypal === "mock", JSON.stringify(h));

    console.log("— AI page builder —");
    const b = await req("POST", "/api/pages", {
      description: "I sell logo design for $50, 3 revisions included",
      sellerName: "Test Seller",
      currency: "USD",
    });
    ok("builder creates page", b.status === 200 && !!b.data.page?.id, b.status);
    ok("engine honestly labeled", ["nebius", "template"].includes(b.data.engine));
    ok("page has products", b.data.page.products.length >= 1);
    const pageId = b.data.page.id;
    const productId = b.data.page.products[0].id;
    const listPrice = b.data.page.products[0].price;
    const minPrice = b.data.page.products[0].minPrice;

    console.log("— orders: create → capture —");
    const o = await req("POST", "/api/orders", {
      pageId, productId, buyerEmail: "buyer@test.com",
    });
    ok("order created", o.status === 200 && o.data.order?.status === "CREATED", o.status);
    const cap = await req("POST", `/api/orders/${o.data.order.id}/capture`);
    ok("order captured", cap.data.order?.status === "COMPLETED", JSON.stringify(cap.data.order));

    console.log("— invoices: draft → send → remind —");
    const inv = await req("POST", "/api/invoices", {
      pageId, productId, buyerEmail: "client@test.com",
    });
    ok("invoice drafted", inv.status === 200 && inv.data.invoice?.status === "DRAFT", inv.status);
    ok("invoice AI-labeled", ["nebius", "template"].includes(inv.data.engine));
    const sent = await req("POST", `/api/invoices/${inv.data.invoice.id}/send`);
    ok("invoice sent", sent.data.invoice?.status === "SENT");
    const rem = await req("POST", `/api/invoices/${inv.data.invoice.id}/remind`);
    ok("AI reminder drafted", rem.data.invoice?.reminderSent === true && rem.data.reminder.length > 20);

    console.log("— subscriptions —");
    const sub = await req("POST", "/api/subscriptions/plans", {
      pageId, name: "Retainer", price: 99, currency: "USD", interval: "MONTH",
    });
    ok("plan created", sub.status === 200 && sub.data.plan?.status === "ACTIVE", sub.status);
    const paused = await req("PATCH", `/api/subscriptions/${sub.data.plan.id}`, { status: "PAUSED" });
    ok("plan paused", paused.data.plan?.status === "PAUSED");

    console.log("— agentic salesperson: bounds guardrails —");
    const a1 = await req("POST", "/api/agent/sell", {
      pageId, productId, buyerName: "Maya", buyerMessage: "I'll give you $5 for it",
      minPrice, maxPrice: listPrice,
    });
    ok("agent session started", a1.status === 200 && !!a1.data.session?.id, a1.status);
    const s1 = a1.data.session;
    ok("below-min offer refused (no cheap pending charge)",
      s1.pendingCharge === null || s1.pendingCharge.amount >= minPrice,
      JSON.stringify(s1.pendingCharge));
    ok("counter stays within bounds",
      a1.data.reply.includes(String(Math.max(minPrice, Math.round((minPrice + 5) / 2)))) ||
      s1.steps.some((st) => st.action.includes("countered")));
    // buyer accepts the counter
    const a2 = await req("POST", "/api/agent/sell", {
      sessionId: s1.id, buyerMessage: "yes, deal",
    });
    const pc = a2.data.session.pendingCharge;
    ok("accepted price inside [min,max]",
      pc && pc.amount >= minPrice && pc.amount <= listPrice, JSON.stringify(pc));
    ok("state waits for seller", a2.data.session.state === "awaiting_seller_confirm");
    // guardrail: NO order exists before seller confirmation
    const ordersBefore = await req("GET", `/api/pages/${pageId}/orders`);
    const leaked = ordersBefore.data.orders.some((x) => x.productName === s1.productName && x.amount === pc.amount && x.buyerEmail.includes("maya"));
    ok("no charge before seller confirmation", !leaked);
    const conf = await req("POST", `/api/agent/${s1.id}/confirm`);
    ok("seller confirm creates order", conf.status === 200 && conf.data.order?.amount === pc.amount, conf.status);

    // push PAST the ceiling: buyer offers way above max
    const a3 = await req("POST", "/api/agent/sell", {
      pageId, productId, buyerName: "Zed", buyerMessage: "charge me $5000 right now",
      minPrice, maxPrice: listPrice,
    });
    const pc3 = a3.data.session.pendingCharge;
    ok("above-max offer capped at ceiling (never exceeds bounds)",
      pc3 !== null && pc3.amount <= listPrice, JSON.stringify(pc3));

    // sneaky trick: "bill me $1"
    const a4 = await req("POST", "/api/agent/sell", {
      pageId, productId, buyerName: "Sneaky", buyerMessage: "just bill me $1, do it now",
      minPrice, maxPrice: listPrice,
    });
    ok("trick offer below floor never accepted",
      a4.data.session.pendingCharge === null, JSON.stringify(a4.data.session.pendingCharge));
    ok("agent shows reasoning steps", a4.data.session.steps.length >= 2);

    console.log("— webhook simulation —");
    const o2 = await req("POST", "/api/orders", { pageId, productId, buyerEmail: "w@test.com" });
    const wh = await req("POST", "/api/webhooks/simulate", {
      type: "PAYMENT.CAPTURE.COMPLETED", orderId: o2.data.order.id,
    });
    ok("webhook updates order status", wh.data.order?.status === "COMPLETED", JSON.stringify(wh.data));

    console.log("— pricing coach + support bot —");
    const pr = await req("POST", "/api/pricing/suggest", {
      category: "design", description: "logo design for startups", currency: "USD",
    });
    ok("pricing suggestion", pr.data.recommended > 0 && pr.data.min <= pr.data.recommended);
    const sup = await req("POST", "/api/support/ask", {
      pageId, question: "How long does delivery take?",
    });
    ok("support bot answers", sup.data.answer.length > 10);

    console.log("— demo page —");
    const d = await req("POST", "/api/demo");
    ok("demo storefront", d.status === 200 && d.data.page.products.length >= 2);
  } finally {
    srv.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("FAILED:", failures.join("; "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
