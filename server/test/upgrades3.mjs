// Vendora Pay AI — upgrades round 3 tests (plain node, no deps).
// Covers: (1) Roman Hindi detection, (2) Photo -> Listing, (3) Returns/refunds,
// (4) Competitor price watch. Spawns the built server with PAYPAL_MOCK=1.
// Run: npm run build --prefix server && node server/test/upgrades3.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 4313;
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

// 1x1 transparent PNG (valid image, tiny)
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  const srv = spawn("node", [path.join(ROOT, "dist/index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PAYPAL_MOCK: "1",
      VENDORA_DATA_FILE: "/tmp/vendorapay-upg3.json",
      SALES_BRAIN: "heuristic", // deterministic, no AI key
      // NOTE: no NEBIUS_API_KEY, no TAVILY_API_KEY -> honest fallbacks
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", () => {});
  srv.stderr.on("data", () => {});
  process.on("exit", () => srv.kill());
  const fs = await import("node:fs");
  try { fs.unlinkSync("/tmp/vendorapay-upg3.json"); } catch {}

  // ---- unit tests: import built modules directly ----
  const { detectLanguage } = await import(path.join(ROOT, "dist/translate.js"));
  const { validatePhotoUpload } = await import(path.join(ROOT, "dist/vision.js"));
  const pw = await import(path.join(ROOT, "dist/pricewatch.js"));

  console.log("— Feature 1: Roman Hindi detection (unit) —");
  ok("roman hindi detected", detectLanguage("yeh kitne ka hai bhai").lang === "hi-roman");
  ok("roman hindi 2", detectLanguage("bhai price kya hai, thoda kam karo").lang === "hi-roman");
  ok("devanagari still hi", detectLanguage("यह कितने का है?").lang === "hi");
  ok("english stays en", detectLanguage("what is the price").lang === "en");
  ok("hello stays en", detectLanguage("hello").lang === "en");
  ok(
    "no false positive on 'me and ke went'",
    detectLanguage("me and ke went").lang === "en"
  );
  ok(
    "no false positive on 'is this refundable?'",
    detectLanguage("is this refundable?").lang === "en"
  );
  ok(
    "method labeled heuristic",
    /heuristic/i.test(detectLanguage("yeh kitne ka hai bhai").method)
  );

  console.log("— Feature 2: photo validation (unit) —");
  ok("rejects non-image", validatePhotoUpload("application/pdf", 100) !== null);
  ok("rejects oversized", validatePhotoUpload("image/png", 6 * 1024 * 1024) !== null);
  ok("rejects empty", validatePhotoUpload("image/png", 0) !== null);
  ok("accepts valid png", validatePhotoUpload("image/png", 1000) === null);
  ok("accepts jpeg", validatePhotoUpload("image/jpeg", 1000) === null);

  console.log("— Feature 4: price extraction + alerts (unit) —");
  const px1 = pw.extractPrice("Buy now for $49.99 only!");
  ok("extracts $ price", px1 !== null && px1.price === 49.99 && px1.currency === "USD");
  ok("extracts USD suffix", pw.extractPrice("Only 79 USD today")?.price === 79);
  ok("no price -> null", pw.extractPrice("no numbers here") === null);
  ok("priceWatch unavailable without key", pw.priceWatchAvailable() === false);
  // Alert logic with seeded data
  pw.clearWatchesForTest();
  const w = pw.watchProduct("p1", "prod1", "Logo Design", 100, "USD", "logo design price");
  pw.seedWatchForTest(w, [
    { title: "Cheap logos", price: 49, currency: "USD", url: "http://x", snippet: "" },
    { title: "Premium logos", price: 150, currency: "USD", url: "http://y", snippet: "" },
  ]);
  const alerts = pw.getAlerts("p1");
  ok("alert for undercutting competitor", alerts.length === 1 && alerts[0].competitorPrice === 49);
  ok("savings computed", alerts[0]?.savings === 51);
  ok("no alert for pricier competitor", !alerts.some((a) => a.competitorPrice === 150));
  pw.clearWatchesForTest();

  try {
    await waitForHealth(srv);

    // ---- setup: page with a product ----
    const b = await req("POST", "/api/pages", {
      description: "I sell logo design for $50",
      sellerName: "Test Seller",
      currency: "USD",
    });
    const pageId = b.data.page.id;
    const page = (await req("GET", `/api/pages/${pageId}`)).data.page;
    const prod = page.products[0];
    ok("test page ready", !!pageId && !!prod, `page=${pageId}`);

    console.log("— Feature 1: Roman Hindi via agent API —");
    const sell = await req("POST", "/api/agent/sell", {
      pageId,
      productId: prod.id,
      buyerMessage: "yeh kitne ka hai bhai, thoda kam karo",
    });
    const sess = sell.data.session;
    const buyerMsg = sess.messages.find((m) => m.role === "buyer");
    ok("agent sell works", sell.status === 200 && !!sess);
    ok("buyer msg tagged hi-roman", buyerMsg?.lang === "hi-roman", `got ${buyerMsg?.lang}`);
    ok(
      "translation honestly skipped without key",
      buyerMsg?.translationAI === false,
      "must not fake translation"
    );

    console.log("— Feature 2: photo-listing API —");
    const bad1 = await req("POST", "/api/ai/photo-listing", {
      imageBase64: "aGVsbG8=",
      mimeType: "application/pdf",
    });
    ok("rejects non-image mime", bad1.status === 400);
    const bad2 = await req("POST", "/api/ai/photo-listing", { mimeType: "image/png" });
    ok("rejects missing fields", bad2.status === 400);
    const good = await req("POST", "/api/ai/photo-listing", {
      imageBase64: TINY_PNG_B64,
      mimeType: "image/png",
    });
    ok("valid upload accepted", good.status === 200);
    ok(
      "no-key -> honest ai:false",
      good.data.listing?.ai === false,
      `engine=${good.data.listing?.engine}`
    );
    ok(
      "never fakes a description",
      good.data.listing?.title === "" && good.data.listing?.description === ""
    );

    console.log("— Feature 3: returns / refunds —");
    // Create + capture an order (mock PayPal)
    const o = await req("POST", "/api/orders", {
      pageId,
      productId: prod.id,
      buyerEmail: "buyer@test.com",
    });
    const orderId = o.data.order.id;
    const cap = await req("POST", `/api/orders/${orderId}/capture`);
    ok("order captured", cap.data.order?.status === "CAPTURED" || cap.data.order?.status === "COMPLETED");

    // Return on non-captured order -> reject
    const o2 = await req("POST", "/api/orders", {
      pageId,
      productId: prod.id,
      buyerEmail: "buyer2@test.com",
    });
    const badRet = await req("POST", `/api/orders/${o2.data.order.id}/return`, { reason: "want refund" });
    ok("return on uncaptured order rejected", badRet.status === 400);

    // Valid return request
    const rr = await req("POST", `/api/orders/${orderId}/return`, { reason: "not as described" });
    ok("return requested", rr.status === 200 && rr.data.return?.status === "PENDING");
    const retId = rr.data.return.id;
    ok("agent summary drafted", typeof rr.data.return?.agentSummary === "string");
    ok(
      "agent engine honest",
      /template|nebius|heuristic/i.test(rr.data.return?.agentEngine ?? "")
    );

    // Duplicate return -> reject
    const dup = await req("POST", `/api/orders/${orderId}/return`, { reason: "again" });
    ok("duplicate return rejected", dup.status === 400);

    // Expired window: set window to 0 days
    await req("POST", `/api/pages/${pageId}/return-window`, { days: 0 });
    const o3 = await req("POST", "/api/orders", {
      pageId,
      productId: prod.id,
      buyerEmail: "buyer3@test.com",
    });
    await req("POST", `/api/orders/${o3.data.order.id}/capture`);
    const exp = await req("POST", `/api/orders/${o3.data.order.id}/return`, { reason: "late" });
    ok("expired window rejected", exp.status === 400);
    await req("POST", `/api/pages/${pageId}/return-window`, { days: 7 }); // restore

    // List returns
    const list = await req("GET", `/api/pages/${pageId}/returns`);
    ok("returns listed", list.status === 200 && list.data.returns.length >= 1);

    // Seller decline -> no refund
    const dec = await req("POST", `/api/returns/${retId}/decide`, {
      approved: false,
      sellerNote: "already delivered",
    });
    ok("decline works", dec.status === 200 && dec.data.return?.status === "DECLINED");
    ok("declined has no refund id", !dec.data.return?.paypalRefundId);

    // New return -> approve -> mock refund
    const o4 = await req("POST", "/api/orders", {
      pageId,
      productId: prod.id,
      buyerEmail: "buyer4@test.com",
    });
    await req("POST", `/api/orders/${o4.data.order.id}/capture`);
    const rr2 = await req("POST", `/api/orders/${o4.data.order.id}/return`, { reason: "defective" });
    const retId2 = rr2.data.return.id;
    const app = await req("POST", `/api/returns/${retId2}/decide`, { approved: true });
    ok("approve -> refunded (mock)", app.status === 200 && app.data.return?.status === "REFUNDED");
    ok("mock refund id present", typeof app.data.return?.paypalRefundId === "string");

    // Double-decide -> reject
    const dbl = await req("POST", `/api/returns/${retId2}/decide`, { approved: true });
    ok("double decide rejected", dbl.status === 400);

    console.log("— Feature 4: price watch API —");
    const pw1 = await req("POST", `/api/pages/${pageId}/products/${prod.id}/watch`, {
      query: "logo design price",
    });
    ok("watch registered", pw1.status === 200 && !!pw1.data.watch?.id);
    ok("available honestly false without key", pw1.data.available === false);
    const watchId = pw1.data.watch.id;
    const chk = await req("POST", "/api/pricewatch/check", { watchId });
    ok("manual check works", chk.status === 200 && chk.data.checked.length === 1);
    ok(
      "check honestly unavailable without key",
      /no TAVILY_API_KEY/i.test(chk.data.checked[0]?.lastError ?? "")
    );
    const al = await req("GET", `/api/pages/${pageId}/price-alerts`);
    ok("alerts endpoint works", al.status === 200 && Array.isArray(al.data.alerts));
    ok("no fake alerts", al.data.alerts.length === 0);
    const unw = await req("DELETE", `/api/pages/${pageId}/watches/${watchId}`);
    ok("unwatch works", unw.status === 200 && unw.data.ok === true);
    const al2 = await req("GET", `/api/pages/${pageId}/price-alerts`);
    ok("watch removed", al2.data.watches.length === 0);
  } finally {
    srv.kill();
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("failures:", failures.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
