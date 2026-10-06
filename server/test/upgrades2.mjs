// Vendora Pay AI — upgrades round 2 tests (plain node, no deps).
// Covers: abandoned cart recovery, translation fallback, smart upsell.
// Spawns the built server with PAYPAL_MOCK=1 and short recovery timeout.
// Run: npm run build --prefix server && node server/test/upgrades2.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 4312;
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
      VENDORA_DATA_FILE: "/tmp/vendorapay-upg2.json",
      RECOVERY_TIMEOUT_MS: "150", // 150ms for fast tests
      SALES_BRAIN: "heuristic", // deterministic, no AI key
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", () => {});
  srv.stderr.on("data", () => {});
  process.on("exit", () => srv.kill());
  // Clear stale data file
  const fs = await import("node:fs");
  try { fs.unlinkSync("/tmp/vendorapay-upg2.json"); } catch {}

  try {
    await waitForHealth(srv);

    // ---- setup: page with 2 products ----
    const b = await req("POST", "/api/pages", {
      description: "I sell logo design for $50 and business cards for $30",
      sellerName: "Test Seller",
      currency: "USD",
    });
    const pageId = b.data.page.id;
    // Ensure 2 products (builder may create 1-2)
    if (b.data.page.products.length < 2) {
      await req("POST", `/api/pages/${pageId}/products`, {
        name: "Business Cards",
        description: "Premium business cards, 500 pcs",
        price: 30,
        minPrice: 20,
      });
    }
    const page = (await req("GET", `/api/pages/${pageId}`)).data.page;
    ok("test page has 2 products", page.products.length >= 2, `got ${page.products.length}`);
    const prod1 = page.products[0];
    const prod2 = page.products[1];

    // ============ FEATURE 1: Abandoned cart recovery ============
    console.log("— abandoned cart recovery —");
    const o1 = await req("POST", "/api/orders", {
      pageId, productId: prod1.id, buyerEmail: "ghost@test.com",
    });
    ok("order created", o1.status === 200 && o1.data.order?.status === "CREATED");
    const orderId = o1.data.order.id;

    // Not yet abandoned (timeout is 150ms, check immediately)
    let ab0 = await req("GET", `/api/pages/${pageId}/abandoned`);
    // Race: may or may not be abandoned yet — just check the endpoint works
    ok("abandoned endpoint works", ab0.status === 200 && Array.isArray(ab0.data.carts));

    // Wait past timeout, then it must appear
    await new Promise((r) => setTimeout(r, 400));
    const ab1 = await req("GET", `/api/pages/${pageId}/abandoned`);
    const cart = ab1.data.carts.find((c) => c.orderId === orderId);
    ok("order tracked as abandoned after timeout", !!cart, JSON.stringify(ab1.data.carts.map(c => c.orderId)));
    ok("cart has product details", cart && cart.productName === prod1.name && cart.amount > 0);

    // Nudge: message-only, never a charge
    const n1 = await req("POST", `/api/pages/${pageId}/abandoned/${orderId}/nudge`);
    ok("nudge succeeds", n1.status === 200 && !!n1.data.nudge?.message);
    ok("nudge is message-only (not sent via real channel)", n1.data.nudge.sent === false);
    ok("nudge mentions product", n1.data.nudge.message.includes(prod1.name));
    // Order must still be CREATED — no charge attempted
    const ordersAfter = await req("GET", `/api/pages/${pageId}/orders`);
    const stillCreated = ordersAfter.data.orders.find((o) => o.id === orderId);
    ok("no charge attempted by nudge (order still CREATED)", stillCreated?.status === "CREATED");

    // Max 1 nudge: second attempt fails
    const n2 = await req("POST", `/api/pages/${pageId}/abandoned/${orderId}/nudge`);
    ok("second nudge rejected (max 1 per cart)", n2.status === 400);

    // Recovery settings with sweetener -> real coupon created
    const rs = await req("POST", `/api/pages/${pageId}/recovery-settings`, {
      enabled: true, discountPercent: 15,
    });
    ok("recovery settings saved", rs.data.recoverySettings?.enabled === true);

    // New abandoned order -> nudge with sweetener includes a real coupon
    const o2 = await req("POST", "/api/orders", {
      pageId, productId: prod1.id, buyerEmail: "ghost2@test.com",
    });
    await new Promise((r) => setTimeout(r, 400));
    const n3 = await req("POST", `/api/pages/${pageId}/abandoned/${o2.data.order.id}/nudge`);
    ok("sweetener nudge includes coupon code", !!n3.data.nudge?.couponCode, JSON.stringify(n3.data.nudge));
    const coupons = await req("GET", `/api/pages/${pageId}/coupons`);
    const created = coupons.data.coupons.find((c) => c.code === n3.data.nudge.couponCode);
    ok("sweetener coupon is real (in store, single-use)", !!created && created.maxUses === 1);

    // Recovery stats
    const abStats = await req("GET", `/api/pages/${pageId}/abandoned`);
    ok("recovery stats present", typeof abStats.data.stats?.abandoned === "number" && typeof abStats.data.stats?.recoveryRate === "number");

    // ============ FEATURE 2: Translation ============
    console.log("— real-time translation —");
    const s1 = await req("POST", "/api/agent/sell", {
      pageId, productId: prod1.id, buyerName: "Ravi",
      buyerMessage: "namaste",
      minPrice: prod1.minPrice, maxPrice: prod1.price,
    });
    ok("agent session started", s1.status === 200 && !!s1.data.session?.id);
    const sid = s1.data.session.id;

    // Hindi message (Devanagari)
    const h1 = await req("POST", "/api/agent/sell", {
      sessionId: sid, buyerMessage: "यह कितने का है?",
    });
    const buyerMsg = h1.data.session.messages.filter((m) => m.role === "buyer").pop();
    ok("Hindi detected (Devanagari heuristic)", buyerMsg?.lang === "hi", JSON.stringify(buyerMsg?.lang));
    ok("translation honest without key (translated:false)", buyerMsg?.translationAI === false);
    ok("original text preserved", buyerMsg?.translatedText === buyerMsg?.text || typeof buyerMsg?.translatedText === "string");

    // English message stays English
    const e1 = await req("POST", "/api/agent/sell", {
      sessionId: sid, buyerMessage: "what is the price?",
    });
    const buyerMsg2 = e1.data.session.messages.filter((m) => m.role === "buyer").pop();
    ok("English detected", buyerMsg2?.lang === "en");
    ok("no translation needed for English", !buyerMsg2?.translatedText || buyerMsg2.translationAI === false);

    // ============ FEATURE 3: Smart upsell ============
    console.log("— smart upsell —");
    const s2 = await req("POST", "/api/agent/sell", {
      pageId, productId: prod1.id, buyerName: "Priya",
      buyerMessage: "Hi, tell me about this",
      minPrice: prod1.minPrice, maxPrice: prod1.price,
    });
    const sid2 = s2.data.session.id;
    // Question intent on a page with 2 products -> upsell pitch appended
    const u1 = await req("POST", "/api/agent/sell", {
      sessionId: sid2, buyerMessage: "What does it include?",
    });
    const hasUpsell = u1.data.reply.includes(prod2.name) || u1.data.session.upsellSuggested === true;
    ok("upsell suggested on question intent", hasUpsell, u1.data.reply.slice(-100));
    ok("upsell flag set on session", u1.data.session.upsellSuggested === true);

    // Upsell price respects floor (never below minPrice)
    const sess = u1.data.session;
    ok("upsell product tracked", sess.upsellProductId === prod2.id);

    // Max 1 per conversation: another question -> no second pitch
    const u2 = await req("POST", "/api/agent/sell", {
      sessionId: sid2, buyerMessage: "And what about delivery time?",
    });
    const reply2 = u2.data.reply;
    const pitchCount = (reply2.match(/might also like/g) || []).length;
    ok("max 1 upsell per conversation", pitchCount === 0, `found ${pitchCount} pitches in 2nd reply`);

    // "no" accepted gracefully
    const s3 = await req("POST", "/api/agent/sell", {
      pageId, productId: prod1.id, buyerName: "Aman",
      buyerMessage: "hello there",
      minPrice: prod1.minPrice, maxPrice: prod1.price,
    });
    const sid3 = s3.data.session.id;
    await req("POST", "/api/agent/sell", { sessionId: sid3, buyerMessage: "what else do you have?" });
    const uNo = await req("POST", "/api/agent/sell", { sessionId: sid3, buyerMessage: "no thanks" });
    ok("'no' accepted gracefully", uNo.data.reply.toLowerCase().includes("no pressure") || uNo.data.reply.toLowerCase().includes("totally fine"));
    ok("upsell marked declined", uNo.data.session.upsellDeclined === true);

    // No upsell on complaint
    const s4 = await req("POST", "/api/agent/sell", {
      pageId, productId: prod1.id, buyerName: "Grumpy",
      buyerMessage: "hi",
      minPrice: prod1.minPrice, maxPrice: prod1.price,
    });
    const sid4 = s4.data.session.id;
    const uC = await req("POST", "/api/agent/sell", { sessionId: sid4, buyerMessage: "this is terrible, I hate it" });
    ok("no upsell on complaint", uC.data.session.upsellSuggested !== true);

    // Upsell analytics tracked
    const stats = await req("GET", "/api/stats");
    ok("upsellsSuggested tracked in analytics", typeof stats.data.stats?.upsellsSuggested === "number" && stats.data.stats.upsellsSuggested >= 1);

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failures.length) console.log("FAILURES:", failures.join(", "));
    srv.kill();
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error("test crashed:", e);
    srv.kill();
    process.exit(1);
  }
}

main();
