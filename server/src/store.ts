// Vendora Pay AI — in-memory store with JSON file persistence.
import fs from "node:fs";
import path from "node:path";

export interface ProductFAQ {
  q: string;
  a: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  /** negotiation floor for the agentic salesperson (<= price) */
  minPrice: number;
  faq: ProductFAQ[];
}

export interface Page {
  id: string;
  slug: string;
  sellerName: string;
  title: string;
  tagline: string;
  currency: string;
  themeColor: string;
  category: string;
  /** which engine built this page: "nebius" or "template" (honest label) */
  engine: string;
  createdAt: string;
  products: Product[];
  /** abandoned-cart recovery sweetener; default off (reminder only) */
  recoverySettings?: {
    enabled: boolean;
    /** 1-30; only used when enabled */
    discountPercent?: number;
  };
}

export type OrderStatus =
  | "CREATED"
  | "APPROVED"
  | "CAPTURED"
  | "COMPLETED"
  | "FAILED";

export interface Order {
  id: string;
  paypalOrderId: string;
  pageId: string;
  productId: string;
  productName: string;
  amount: number;
  currency: string;
  buyerEmail: string;
  status: OrderStatus;
  createdAt: string;
  /** coupon code applied at checkout; consumed only on successful capture */
  couponCode?: string;
}

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  paypalInvoiceId: string;
  pageId: string;
  productName: string;
  buyerEmail: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  lineItems: InvoiceLine[];
  notes: string;
  dueDate: string;
  createdAt: string;
  reminderSent: boolean;
  reminderText?: string;
}

export interface SubscriptionPlan {
  id: string;
  paypalPlanId: string;
  pageId: string;
  name: string;
  price: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  createdAt: string;
}

export interface AgentMessage {
  role: "buyer" | "agent" | "system";
  text: string;
  at: string;
  /** detected language of the original text ("en" | "hi"), heuristic */
  lang?: "en" | "hi";
  /** translation of text (shown alongside original in UI) */
  translatedText?: string;
  /** true ONLY when a real AI call produced translatedText */
  translationAI?: boolean;
}

export interface AgentStep {
  step: number;
  reasoning: string;
  action: string;
}

export type AgentState =
  | "active"
  | "awaiting_seller_confirm"
  | "confirmed"
  | "completed"
  | "declined";

export interface AgentSession {
  id: string;
  pageId: string;
  productId: string;
  productName: string;
  buyerName: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  state: AgentState;
  messages: AgentMessage[];
  steps: AgentStep[];
  /** set when the agent and buyer agreed — charged ONLY after seller confirm */
  pendingCharge: { amount: number; currency: string } | null;
  orderId?: string;
  createdAt: string;
  /** smart-upsell state: at most one suggestion per conversation */
  upsellSuggested?: boolean;
  upsellProductId?: string;
  upsellDeclined?: boolean;
}

const DATA_FILE =
  process.env.VENDORA_DATA_FILE ??
  path.join(process.cwd(), "vendorapay-data.json");

const pages = new Map<string, Page>();
const orders = new Map<string, Order>();
const invoices = new Map<string, Invoice>();
const plans = new Map<string, SubscriptionPlan>();
const sessions = new Map<string, AgentSession>();
const views = new Map<string, number>();

// --- Abandoned carts (recovery) ---
export interface AbandonedCart {
  id: string;
  orderId: string;
  pageId: string;
  productId: string;
  productName: string;
  amount: number;
  currency: string;
  buyerEmail: string;
  createdAt: string;
  abandonedAt: string;
  nudged: boolean;
  nudgedAt?: string;
  nudgeText?: string;
  recovered: boolean;
}
const abandonedCarts = new Map<string, AbandonedCart>(); // key: orderId

// --- Upsell analytics counters ---
let upsellsSuggested = 0;
let upsellsAccepted = 0;

function persist() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          pages: [...pages.values()],
          orders: [...orders.values()],
          invoices: [...invoices.values()],
          plans: [...plans.values()],
          sessions: [...sessions.values()],
          views: [...views.entries()],
          coupons: [...coupons.values()],
          abandonedCarts: [...abandonedCarts.values()],
          upsellsSuggested,
          upsellsAccepted,
        },
        null,
        2
      )
    );
  } catch {
    /* best effort */
  }
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const d = JSON.parse(raw) as {
      pages?: Page[];
      orders?: Order[];
      invoices?: Invoice[];
      plans?: SubscriptionPlan[];
      sessions?: AgentSession[];
      views?: Array<[string, number]>;
      coupons?: Coupon[];
      abandonedCarts?: AbandonedCart[];
      upsellsSuggested?: number;
      upsellsAccepted?: number;
    };
    for (const p of d.pages ?? []) pages.set(p.id, p);
    for (const o of d.orders ?? []) orders.set(o.id, o);
    for (const i of d.invoices ?? []) invoices.set(i.id, i);
    for (const s of d.plans ?? []) plans.set(s.id, s);
    for (const s of d.sessions ?? []) sessions.set(s.id, s);
    for (const [k, v] of d.views ?? []) views.set(k, v);
    for (const c of d.coupons ?? []) coupons.set(couponKey(c.pageId, c.code), c);
    for (const c of d.abandonedCarts ?? []) abandonedCarts.set(c.orderId, c);
    if (typeof d.upsellsSuggested === "number") upsellsSuggested = d.upsellsSuggested;
    if (typeof d.upsellsAccepted === "number") upsellsAccepted = d.upsellsAccepted;
  } catch {
    /* fresh start */
  }
}

export function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Pages ---
export function savePage(p: Page): void {
  pages.set(p.id, p);
  persist();
}
export function getPage(id: string): Page | null {
  return pages.get(id) ?? null;
}
export function listPages(): Page[] {
  return [...pages.values()];
}
export function addProduct(pageId: string, prod: Product): Page | null {
  const p = pages.get(pageId);
  if (!p) return null;
  p.products.push(prod);
  persist();
  return p;
}
export function removeProduct(pageId: string, productId: string): Page | null {
  const p = pages.get(pageId);
  if (!p) return null;
  p.products = p.products.filter((x) => x.id !== productId);
  persist();
  return p;
}

// --- Orders ---
export function saveOrder(o: Order): void {
  orders.set(o.id, o);
  persist();
}
export function getOrder(id: string): Order | null {
  return orders.get(id) ?? null;
}
export function listOrders(pageId?: string): Order[] {
  const all = [...orders.values()];
  return pageId ? all.filter((o) => o.pageId === pageId) : all;
}
export function setOrderStatus(id: string, status: OrderStatus): Order | null {
  const o = orders.get(id);
  if (!o) return null;
  o.status = status;
  persist();
  return o;
}

// --- Invoices ---
export function saveInvoice(i: Invoice): void {
  invoices.set(i.id, i);
  persist();
}
export function getInvoice(id: string): Invoice | null {
  return invoices.get(id) ?? null;
}
export function listInvoices(pageId?: string): Invoice[] {
  const all = [...invoices.values()];
  return pageId ? all.filter((i) => i.pageId === pageId) : all;
}

// --- Subscription plans ---
export function savePlan(p: SubscriptionPlan): void {
  plans.set(p.id, p);
  persist();
}
export function getPlan(id: string): SubscriptionPlan | null {
  return plans.get(id) ?? null;
}
export function listPlans(pageId?: string): SubscriptionPlan[] {
  const all = [...plans.values()];
  return pageId ? all.filter((p) => p.pageId === pageId) : all;
}

// --- Agent sessions ---
export function saveSession(s: AgentSession): void {
  sessions.set(s.id, s);
  persist();
}
export function getSession(id: string): AgentSession | null {
  return sessions.get(id) ?? null;
}
export function listSessions(pageId?: string): AgentSession[] {
  const all = [...sessions.values()];
  return pageId ? all.filter((s) => s.pageId === pageId) : all;
}

// --- Abandoned carts ---
export function saveAbandonedCart(c: AbandonedCart): void {
  abandonedCarts.set(c.orderId, c);
  persist();
}
export function listAbandonedCarts(pageId?: string): AbandonedCart[] {
  const all = [...abandonedCarts.values()];
  return pageId ? all.filter((c) => c.pageId === pageId) : all;
}
export function setAbandonedNudged(orderId: string, nudged: boolean, nudgeText?: string): AbandonedCart | null {
  const c = abandonedCarts.get(orderId);
  if (!c) return null;
  c.nudged = nudged;
  if (nudged) c.nudgedAt = new Date().toISOString();
  if (nudgeText !== undefined) c.nudgeText = nudgeText;
  persist();
  return c;
}
export function setAbandonedRecovered(orderId: string, recovered: boolean): AbandonedCart | null {
  const c = abandonedCarts.get(orderId);
  if (!c) return null;
  c.recovered = recovered;
  persist();
  return c;
}

// --- Upsell analytics ---
export function countUpsellSuggested(): number {
  upsellsSuggested += 1;
  persist();
  return upsellsSuggested;
}
export function countUpsellAccepted(): number {
  upsellsAccepted += 1;
  persist();
  return upsellsAccepted;
}
export function getUpsellStats(): { upsellsSuggested: number; upsellsAccepted: number } {
  return { upsellsSuggested, upsellsAccepted };
}

// --- One-click demo storefront (judge-friendly seed) ---
// --- Page views (analytics) ---
export function recordView(pageId: string): void {
  views.set(pageId, (views.get(pageId) ?? 0) + 1);
  persist();
}
export function getPageViews(pageId: string): number {
  return views.get(pageId) ?? 0;
}
export function getAllViews(): Record<string, number> {
  return Object.fromEntries(views);
}

// --- Analytics ---
export interface PageStats {
  pageId: string;
  title: string;
  views: number;
  orders: number;
  revenue: number;
  currency: string;
  conversion: number; // orders / views as %
}
export interface GlobalStats {
  totalPages: number;
  totalViews: number;
  totalOrders: number;
  paidOrders: number;
  totalRevenue: number;
  currency: string;
  conversion: number;
  invoicesSent: number;
  invoicesPaid: number;
  activeSessions: number;
  pages: PageStats[];
  topProducts: Array<{ name: string; revenue: number; orders: number }>;
  upsellsSuggested: number;
  upsellsAccepted: number;
}
// --- Coupons (discount codes) ---
export interface Coupon {
  code: string;
  pageId: string;
  percentOff: number; // 1-90
  maxUses: number;
  usedCount: number;
  createdAt: string;
}
const coupons = new Map<string, Coupon>(); // key: pageId + ":" + CODE

function couponKey(pageId: string, code: string): string {
  return `${pageId}:${code.toUpperCase()}`;
}
export function saveCoupon(c: Coupon): void {
  coupons.set(couponKey(c.pageId, c.code), c);
  persist();
}
export function getCoupon(pageId: string, code: string): Coupon | null {
  return coupons.get(couponKey(pageId, code)) ?? null;
}
export function listCoupons(pageId: string): Coupon[] {
  return [...coupons.values()].filter((c) => c.pageId === pageId);
}
/** Validate without consuming. Returns discount info or an error string. */
export function validateCoupon(
  pageId: string,
  code: string
): { coupon: Coupon; percentOff: number } | { error: string } {
  const c = getCoupon(pageId, code);
  if (!c) return { error: "Invalid coupon code." };
  if (c.usedCount >= c.maxUses) return { error: "This coupon has been fully used." };
  return { coupon: c, percentOff: c.percentOff };
}
/** Validate + consume one use. Returns discounted info or an error string. */
export function applyCoupon(
  pageId: string,
  code: string
): { coupon: Coupon; percentOff: number } | { error: string } {
  const v = validateCoupon(pageId, code);
  if ("error" in v) return v;
  v.coupon.usedCount += 1;
  persist();
  return v;
}

export function getStats(): GlobalStats {
  const allOrders = [...orders.values()];
  const paid = allOrders.filter((o) =>
    ["CAPTURED", "COMPLETED"].includes(o.status)
  );
  const revenue = paid.reduce((s, o) => s + o.amount, 0);
  const currency = paid[0]?.currency ?? allOrders[0]?.currency ?? "USD";
  const totalViews = [...views.values()].reduce((s, v) => s + v, 0);
  const allInvoices = [...invoices.values()];
  const pageStats: PageStats[] = [...pages.values()].map((p) => {
    const po = allOrders.filter((o) => o.pageId === p.id);
    const pr = po
      .filter((o) => ["CAPTURED", "COMPLETED"].includes(o.status))
      .reduce((s, o) => s + o.amount, 0);
    const v = views.get(p.id) ?? 0;
    return {
      pageId: p.id,
      title: p.title,
      views: v,
      orders: po.length,
      revenue: pr,
      currency: p.currency,
      conversion: v > 0 ? Math.round((po.length / v) * 1000) / 10 : 0,
    };
  });
  const prodMap = new Map<string, { revenue: number; orders: number }>();
  for (const o of paid) {
    const e = prodMap.get(o.productName) ?? { revenue: 0, orders: 0 };
    e.revenue += o.amount;
    e.orders += 1;
    prodMap.set(o.productName, e);
  }
  const topProducts = [...prodMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  return {
    totalPages: pages.size,
    totalViews,
    totalOrders: allOrders.length,
    paidOrders: paid.length,
    totalRevenue: Math.round(revenue * 100) / 100,
    currency,
    conversion:
      totalViews > 0
        ? Math.round((allOrders.length / totalViews) * 1000) / 10
        : 0,
    invoicesSent: allInvoices.filter((i) =>
      ["SENT", "PAID"].includes(i.status)
    ).length,
    invoicesPaid: allInvoices.filter((i) => i.status === "PAID").length,
    activeSessions: [...sessions.values()].filter((s) =>
      ["active", "awaiting_seller_confirm"].includes(s.state)
    ).length,
    pages: pageStats.sort((a, b) => b.revenue - a.revenue),
    topProducts,
    upsellsSuggested,
    upsellsAccepted,
  };
}

export function createDemoPage(): Page {
  const p: Page = {
    id: rid("page"),
    slug: "demo-studio",
    sellerName: "Aarav Sharma",
    title: "Aarav's Design Studio",
    tagline: "Logos & brand kits that make startups look funded.",
    currency: "USD",
    themeColor: "#7c3aed",
    category: "design",
    engine: "template",
    createdAt: new Date().toISOString(),
    products: [
      {
        id: rid("prod"),
        name: "Logo Design Pack",
        description:
          "Custom logo + 3 revisions + full brand kit (colors, fonts, files). Delivery in 5 days.",
        price: 50,
        currency: "USD",
        minPrice: 35,
        faq: [
          { q: "How long does delivery take?", a: "5 business days from brief confirmation." },
          { q: "How many revisions?", a: "3 rounds of revisions are included." },
          { q: "What files do I get?", a: "SVG, PNG, PDF + a brand guideline sheet." },
        ],
      },
      {
        id: rid("prod"),
        name: "Monthly Design Retainer",
        description:
          "10 design tasks per month — social posts, decks, banners. Pause anytime.",
        price: 199,
        currency: "USD",
        minPrice: 149,
        faq: [
          { q: "Can I pause the retainer?", a: "Yes — pause or cancel anytime, no lock-in." },
          { q: "What counts as a task?", a: "One social post, slide deck section, or banner = 1 task." },
        ],
      },
    ],
  };
  savePage(p);

  // A sample completed order so the dashboard isn't empty
  const o: Order = {
    id: rid("order"),
    paypalOrderId: "MOCK-ORDER-seed1",
    pageId: p.id,
    productId: p.products[0].id,
    productName: p.products[0].name,
    amount: 50,
    currency: "USD",
    buyerEmail: "buyer@example.com",
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
  };
  saveOrder(o);

  const inv: Invoice = {
    id: rid("inv"),
    paypalInvoiceId: "MOCK-INV-seed1",
    pageId: p.id,
    productName: p.products[1].name,
    buyerEmail: "client@example.com",
    amount: 199,
    currency: "USD",
    status: "OVERDUE",
    lineItems: [{ name: "Monthly Design Retainer — October", quantity: 1, unitPrice: 199 }],
    notes: "Retainer for October. Net-7 terms.",
    dueDate: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 10 * 864e5).toISOString(),
    reminderSent: false,
  };
  saveInvoice(inv);

  const plan: SubscriptionPlan = {
    id: rid("sub"),
    paypalPlanId: "MOCK-PLAN-seed1",
    pageId: p.id,
    name: "Design Retainer — Monthly",
    price: 199,
    currency: "USD",
    interval: "MONTH",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };
  savePlan(plan);

  return p;
}

load();
