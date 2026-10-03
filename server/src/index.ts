// Vendora Pay AI server — "Sell anything, anywhere — just describe it."
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentStep, confirmSession, declineSession, startSession } from "./agent.js";
import {
  buildPageFromChat,
  draftInvoice,
  draftReminder,
  suggestPrice,
  supportAnswer,
  aiMode,
} from "./ai.js";
import {
  captureOrder,
  createInvoiceDraft,
  createOrder,
  createSubscriptionPlan,
  paypalMode,
  paypalReady,
  sendInvoice,
} from "./paypal.js";
import {
  addProduct,
  createDemoPage,
  getInvoice,
  getOrder,
  getPage,
  getPlan,
  getSession,
  listInvoices,
  listOrders,
  listPages,
  listPlans,
  listSessions,
  removeProduct,
  rid,
  saveInvoice,
  saveOrder,
  savePage,
  savePlan,
  saveSession,
  setOrderStatus,
  type Invoice,
  type OrderStatus,
  type Page,
  type Product,
} from "./store.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    paypal: paypalMode(),
    ai: aiMode(),
    time: new Date().toISOString(),
  });
});

// ---------- AI Page Builder ----------
app.post("/api/pages", async (req, res) => {
  const { description, sellerName, currency } = req.body ?? {};
  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required — describe what you sell" });
    return;
  }
  const cur = typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase().slice(0, 3) : "USD";
  try {
    const built = await buildPageFromChat(description, String(sellerName ?? ""), cur);
    const page: Page = {
      id: rid("page"),
      slug: built.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || rid("p"),
      sellerName: String(sellerName ?? "").trim().slice(0, 40) || "Your Studio",
      title: built.title,
      tagline: built.tagline,
      currency: built.currency,
      themeColor: built.themeColor,
      category: built.category,
      engine: built.engine,
      createdAt: new Date().toISOString(),
      products: built.products.map((p) => ({
        id: rid("prod"),
        name: p.name,
        description: p.description,
        price: p.price,
        currency: built.currency,
        minPrice: Math.min(p.minPrice, p.price),
        faq: p.faq,
      })),
    };
    savePage(page);
    res.json({ page, engine: built.engine });
  } catch (e) {
    res.status(502).json({ error: `page build failed: ${(e as Error).message}` });
  }
});

app.get("/api/pages", (_req, res) => {
  res.json({ pages: listPages().map((p) => ({ id: p.id, title: p.title, sellerName: p.sellerName })) });
});

app.get("/api/pages/:id", (req, res) => {
  const p = getPage(req.params.id);
  if (!p) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  res.json({ page: p, paypal: paypalMode() });
});

app.post("/api/pages/:id/products", (req, res) => {
  const { name, description, price, minPrice, faq } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || !(Number(price) > 0)) {
    res.status(400).json({ error: "name and a positive price are required" });
    return;
  }
  const page = getPage(req.params.id);
  if (!page) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  const prod: Product = {
    id: rid("prod"),
    name: name.trim().slice(0, 80),
    description: String(description ?? "").slice(0, 300),
    price: Math.round(Number(price) * 100) / 100,
    currency: page.currency,
    minPrice: Number(minPrice) > 0 ? Math.min(Number(minPrice), Number(price)) : Math.round(Number(price) * 0.7 * 100) / 100,
    faq: Array.isArray(faq)
      ? faq.slice(0, 4).map((f: { q?: string; a?: string }) => ({
          q: String(f.q ?? "").slice(0, 140),
          a: String(f.a ?? "").slice(0, 300),
        }))
      : [],
  };
  const updated = addProduct(page.id, prod);
  res.json({ page: updated });
});

app.delete("/api/pages/:id/products/:pid", (req, res) => {
  const updated = removeProduct(req.params.id, req.params.pid);
  if (!updated) {
    res.status(404).json({ error: "page or product not found" });
    return;
  }
  res.json({ page: updated });
});

// ---------- Orders (PayPal Checkout) ----------
app.post("/api/orders", async (req, res) => {
  const { pageId, productId, buyerEmail, amount } = req.body ?? {};
  const page = getPage(String(pageId ?? ""));
  const product = page?.products.find((p) => p.id === productId);
  if (!page || !product) {
    res.status(404).json({ error: "page or product not found" });
    return;
  }
  if (!paypalReady()) {
    res.status(503).json({ error: "PayPal is not configured (set keys or PAYPAL_MOCK=1)" });
    return;
  }
  const charge = Number(amount) > 0 ? Number(amount) : product.price;
  try {
    const pp = await createOrder(charge, product.currency, `${product.name} — ${page.title}`);
    const order = {
      id: rid("order"),
      paypalOrderId: pp.id,
      pageId: page.id,
      productId: product.id,
      productName: product.name,
      amount: charge,
      currency: product.currency,
      buyerEmail: String(buyerEmail ?? "").slice(0, 80) || "buyer@example.com",
      status: "CREATED" as const,
      createdAt: new Date().toISOString(),
    };
    saveOrder(order);
    res.json({ order, approveUrl: pp.approveUrl, paypal: paypalMode() });
  } catch (e) {
    res.status(502).json({ error: `order failed: ${(e as Error).message}` });
  }
});

app.post("/api/orders/:id/capture", async (req, res) => {
  const o = getOrder(req.params.id);
  if (!o) {
    res.status(404).json({ error: "order not found" });
    return;
  }
  try {
    const r = await captureOrder(o.paypalOrderId);
    const updated = setOrderStatus(o.id, r.status === "COMPLETED" ? "COMPLETED" : "CAPTURED");
    res.json({ order: updated, paypal: paypalMode() });
  } catch (e) {
    setOrderStatus(o.id, "FAILED");
    res.status(502).json({ error: `capture failed: ${(e as Error).message}` });
  }
});

app.get("/api/pages/:id/orders", (req, res) => {
  if (!getPage(req.params.id)) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  res.json({ orders: listOrders(req.params.id) });
});

// ---------- Invoices ----------
app.post("/api/invoices", async (req, res) => {
  const { pageId, productId, buyerEmail, amount, dueDate } = req.body ?? {};
  const page = getPage(String(pageId ?? ""));
  if (!page) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  const product =
    page.products.find((p) => p.id === productId) ?? page.products[0] ?? null;
  if (!product) {
    res.status(400).json({ error: "add a product to the page first" });
    return;
  }
  if (!paypalReady()) {
    res.status(503).json({ error: "PayPal is not configured (set keys or PAYPAL_MOCK=1)" });
    return;
  }
  try {
    const draft = await draftInvoice(product, String(buyerEmail ?? ""), page.sellerName);
    const total = Number(amount) > 0 ? Number(amount) : draft.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const pp = await createInvoiceDraft({
      buyerEmail: String(buyerEmail ?? "buyer@example.com"),
      currency: product.currency,
      items: Number(amount) > 0
        ? [{ name: product.name, quantity: 1, unitPrice: total }]
        : draft.items,
      notes: draft.notes,
      dueDate: String(dueDate ?? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)),
    });
    const inv: Invoice = {
      id: rid("inv"),
      paypalInvoiceId: pp.id,
      pageId: page.id,
      productName: product.name,
      buyerEmail: String(buyerEmail ?? "buyer@example.com").slice(0, 80),
      amount: Math.round(total * 100) / 100,
      currency: product.currency,
      status: "DRAFT",
      lineItems: draft.items,
      notes: draft.notes,
      dueDate: String(dueDate ?? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)),
      createdAt: new Date().toISOString(),
      reminderSent: false,
    };
    saveInvoice(inv);
    res.json({ invoice: inv, engine: draft.engine });
  } catch (e) {
    res.status(502).json({ error: `invoice failed: ${(e as Error).message}` });
  }
});

app.post("/api/invoices/:id/send", async (req, res) => {
  const inv = getInvoice(req.params.id);
  if (!inv) {
    res.status(404).json({ error: "invoice not found" });
    return;
  }
  try {
    const r = await sendInvoice(inv.paypalInvoiceId);
    inv.status = r.status === "SENT" ? "SENT" : inv.status;
    saveInvoice(inv);
    res.json({ invoice: inv });
  } catch (e) {
    res.status(502).json({ error: `send failed: ${(e as Error).message}` });
  }
});

app.post("/api/invoices/:id/remind", async (req, res) => {
  const inv = getInvoice(req.params.id);
  if (!inv) {
    res.status(404).json({ error: "invoice not found" });
    return;
  }
  const page = getPage(inv.pageId);
  const { text, engine } = await draftReminder(inv, page?.sellerName ?? "Seller");
  inv.reminderSent = true;
  inv.reminderText = text;
  saveInvoice(inv);
  res.json({ invoice: inv, reminder: text, engine });
});

app.post("/api/invoices/:id/mark-paid", (req, res) => {
  const inv = getInvoice(req.params.id);
  if (!inv) {
    res.status(404).json({ error: "invoice not found" });
    return;
  }
  inv.status = "PAID";
  saveInvoice(inv);
  res.json({ invoice: inv });
});

app.get("/api/pages/:id/invoices", (req, res) => {
  if (!getPage(req.params.id)) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  res.json({ invoices: listInvoices(req.params.id) });
});

// ---------- Subscriptions ----------
app.post("/api/subscriptions/plans", async (req, res) => {
  const { pageId, name, price, currency, interval } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || !(Number(price) > 0)) {
    res.status(400).json({ error: "name and a positive price are required" });
    return;
  }
  if (!paypalReady()) {
    res.status(503).json({ error: "PayPal is not configured (set keys or PAYPAL_MOCK=1)" });
    return;
  }
  const iv: "MONTH" | "YEAR" = interval === "YEAR" ? "YEAR" : "MONTH";
  try {
    const pp = await createSubscriptionPlan({
      name: name.trim().slice(0, 80),
      price: Number(price),
      currency: String(currency ?? "USD").toUpperCase().slice(0, 3),
      interval: iv,
    });
    const plan = {
      id: rid("sub"),
      paypalPlanId: pp.id,
      pageId: String(pageId ?? ""),
      name: name.trim().slice(0, 80),
      price: Math.round(Number(price) * 100) / 100,
      currency: String(currency ?? "USD").toUpperCase().slice(0, 3),
      interval: iv,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    savePlan(plan);
    res.json({ plan, paypal: paypalMode() });
  } catch (e) {
    res.status(502).json({ error: `plan failed: ${(e as Error).message}` });
  }
});

app.patch("/api/subscriptions/:id", (req, res) => {
  const p = getPlan(req.params.id);
  if (!p) {
    res.status(404).json({ error: "plan not found" });
    return;
  }
  const st = String(req.body?.status ?? "").toUpperCase();
  if (!["ACTIVE", "PAUSED", "CANCELLED"].includes(st)) {
    res.status(400).json({ error: "status must be ACTIVE, PAUSED or CANCELLED" });
    return;
  }
  p.status = st as "ACTIVE" | "PAUSED" | "CANCELLED";
  savePlan(p);
  res.json({ plan: p });
});

app.get("/api/pages/:id/subscriptions", (req, res) => {
  if (!getPage(req.params.id)) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  res.json({ plans: listPlans(req.params.id) });
});

// ---------- Webhooks ----------
app.post("/api/webhooks/paypal", (req, res) => {
  // Real PayPal webhooks land here. We match on resource ids we created.
  const eventType = String(req.body?.event_type ?? "");
  const resource = (req.body?.resource ?? {}) as Record<string, unknown>;
  const ppId =
    String(resource.id ?? "") ||
    String((resource.purchase_units as Array<{ custom_id?: string }>)?.[0]?.custom_id ?? "");

  const order = listOrders().find((o) => o.paypalOrderId === ppId);
  if (!order) {
    res.json({ ok: true, matched: false });
    return;
  }
  const map: Record<string, OrderStatus> = {
    "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
    "CHECKOUT.ORDER.APPROVED": "APPROVED",
    "PAYMENT.CAPTURE.DENIED": "FAILED",
    "PAYMENT.CAPTURE.REFUNDED": "FAILED",
  };
  const st = map[eventType];
  if (st) setOrderStatus(order.id, st);
  res.json({ ok: true, matched: true, status: st ?? order.status });
});

// Mock-only: simulate a PayPal webhook event (drives the dashboard live)
app.post("/api/webhooks/simulate", (req, res) => {
  if (paypalMode() !== "mock") {
    res.status(400).json({ error: "simulate is mock-mode only" });
    return;
  }
  const { type, orderId } = req.body ?? {};
  const order = getOrder(String(orderId ?? ""));
  if (!order) {
    res.status(404).json({ error: "order not found" });
    return;
  }
  const map: Record<string, OrderStatus> = {
    "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
    "CHECKOUT.ORDER.APPROVED": "APPROVED",
    "PAYMENT.CAPTURE.DENIED": "FAILED",
  };
  const st = map[String(type)] ?? "APPROVED";
  const updated = setOrderStatus(order.id, st);
  res.json({ ok: true, event: type, order: updated });
});

// ---------- Agentic salesperson ----------
app.post("/api/agent/sell", (req, res) => {
  const { sessionId, pageId, productId, buyerName, buyerMessage, minPrice, maxPrice } =
    req.body ?? {};
  // Continue an existing session
  if (sessionId) {
    const r = agentStep(String(sessionId), String(buyerMessage ?? ""));
    if (!r) {
      res.status(404).json({ error: "session not found or closed" });
      return;
    }
    res.json({ session: r.session, reply: r.reply });
    return;
  }
  // Start a new one
  if (!pageId || !productId || typeof buyerMessage !== "string") {
    res.status(400).json({ error: "pageId, productId and buyerMessage are required" });
    return;
  }
  const s = startSession({
    pageId: String(pageId),
    productId: String(productId),
    buyerName: String(buyerName ?? "Buyer"),
    minPrice: Number(minPrice),
    maxPrice: Number(maxPrice),
  });
  if (!s) {
    res.status(404).json({ error: "page or product not found" });
    return;
  }
  const r = agentStep(s.id, buyerMessage);
  res.json({ session: r?.session ?? s, reply: r?.reply ?? "" });
});

app.get("/api/agent/:sid", (req, res) => {
  const s = getSession(req.params.sid);
  if (!s) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({ session: s });
});

app.get("/api/pages/:id/agent", (req, res) => {
  if (!getPage(req.params.id)) {
    res.status(404).json({ error: "page not found" });
    return;
  }
  res.json({ sessions: listSessions(req.params.id) });
});

// Seller CONFIRMS the agent's deal -> the ONLY path that creates a charge
app.post("/api/agent/:sid/confirm", async (req, res) => {
  try {
    const r = await confirmSession(req.params.sid);
    if (!r) {
      res.status(400).json({ error: "nothing to confirm — no agreed deal on this session" });
      return;
    }
    res.json({ session: r.session, order: r.order, paypal: paypalMode() });
  } catch (e) {
    res.status(502).json({ error: `confirm failed: ${(e as Error).message}` });
  }
});

app.post("/api/agent/:sid/decline", (req, res) => {
  const s = declineSession(req.params.sid);
  if (!s) {
    res.status(400).json({ error: "cannot decline this session" });
    return;
  }
  saveSession(s);
  res.json({ session: s });
});

// ---------- AI support bot + pricing coach ----------
app.post("/api/support/ask", async (req, res) => {
  const { pageId, question } = req.body ?? {};
  const page = getPage(String(pageId ?? ""));
  if (!page || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "pageId and question are required" });
    return;
  }
  const { answer, engine } = await supportAnswer(page, question);
  res.json({ answer, engine });
});

app.post("/api/pricing/suggest", async (req, res) => {
  const { category, description, currency } = req.body ?? {};
  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required" });
    return;
  }
  const s = await suggestPrice(
    String(category ?? "services"),
    description,
    String(currency ?? "USD").toUpperCase().slice(0, 3)
  );
  res.json(s);
});

// ---------- One-click demo ----------
app.post("/api/demo", (_req, res) => {
  const page = createDemoPage();
  res.json({ page, paypal: paypalMode() });
});

// Serve the built web app (production)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.join(__dirname, "..", "web");
app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) res.status(404).json({ error: "not found" });
  });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Vendora Pay AI on :${PORT} (paypal: ${paypalMode()}, ai: ${aiMode()})`);
});
