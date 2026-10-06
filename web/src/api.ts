// Vendora Pay AI — API client
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
  engine: string;
  createdAt: string;
  products: Product[];
}

export interface Order {
  id: string;
  paypalOrderId: string;
  pageId: string;
  productId: string;
  productName: string;
  amount: number;
  currency: string;
  buyerEmail: string;
  status: string;
  createdAt: string;
  couponCode?: string;
}

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
  status: string;
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
  interval: string;
  status: string;
  createdAt: string;
}

export interface AgentStep {
  step: number;
  reasoning: string;
  action: string;
}

export interface AgentMessage {
  role: "buyer" | "agent" | "system";
  text: string;
  at: string;
}

export interface AgentSession {
  id: string;
  pageId: string;
  productId: string;
  productName: string;
  buyerName: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  state: string;
  messages: AgentMessage[];
  steps: AgentStep[];
  pendingCharge: { amount: number; currency: string } | null;
  orderId?: string;
  createdAt: string;
}

export interface PriceSuggestion {
  min: number;
  recommended: number;
  max: number;
  rationale: string;
  engine: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; paypal: string; ai: string }>("/api/health"),
  buildPage: (description: string, sellerName: string, currency: string) =>
    req<{ page: Page; engine: string }>("/api/pages", {
      method: "POST",
      body: JSON.stringify({ description, sellerName, currency }),
    }),
  getPage: (id: string) =>
    req<{ page: Page; paypal: string }>(`/api/pages/${encodeURIComponent(id)}`),
  listPages: () =>
    req<{ pages: Array<{ id: string; title: string; sellerName: string }> }>(
      "/api/pages"
    ),
  addProduct: (
    pageId: string,
    p: { name: string; description: string; price: number; minPrice?: number }
  ) =>
    req<{ page: Page }>(`/api/pages/${encodeURIComponent(pageId)}/products`, {
      method: "POST",
      body: JSON.stringify(p),
    }),
  demo: () => req<{ page: Page; paypal: string }>("/api/demo", { method: "POST" }),
  createOrder: (pageId: string, productId: string, buyerEmail: string, couponCode?: string) =>
    req<{ order: Order; approveUrl?: string; paypal: string; appliedCoupon?: string | null }>(
      "/api/orders",
      {
        method: "POST",
        body: JSON.stringify({ pageId, productId, buyerEmail, couponCode }),
      }
    ),
  draftDispute: (orderId: string, disputeReason: string, sellerNotes: string) =>
    req<{ draft: DisputeDraft }>("/api/disputes/draft", {
      method: "POST",
      body: JSON.stringify({ orderId, disputeReason, sellerNotes }),
    }),
  createCoupon: (pageId: string, code: string, percentOff: number, maxUses: number) =>
    req<{ coupon: Coupon }>(`/api/pages/${encodeURIComponent(pageId)}/coupons`, {
      method: "POST",
      body: JSON.stringify({ code, percentOff, maxUses }),
    }),
  listCoupons: (pageId: string) =>
    req<{ coupons: Coupon[] }>(`/api/pages/${encodeURIComponent(pageId)}/coupons`),
  captureOrder: (id: string) =>
    req<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}/capture`, {
      method: "POST",
    }),
  listOrders: (pageId: string) =>
    req<{ orders: Order[] }>(`/api/pages/${encodeURIComponent(pageId)}/orders`),
  createInvoice: (pageId: string, productId: string, buyerEmail: string) =>
    req<{ invoice: Invoice; engine: string }>("/api/invoices", {
      method: "POST",
      body: JSON.stringify({ pageId, productId, buyerEmail }),
    }),
  sendInvoice: (id: string) =>
    req<{ invoice: Invoice }>(`/api/invoices/${encodeURIComponent(id)}/send`, {
      method: "POST",
    }),
  remindInvoice: (id: string) =>
    req<{ invoice: Invoice; reminder: string; engine: string }>(
      `/api/invoices/${encodeURIComponent(id)}/remind`,
      { method: "POST" }
    ),
  markPaid: (id: string) =>
    req<{ invoice: Invoice }>(
      `/api/invoices/${encodeURIComponent(id)}/mark-paid`,
      { method: "POST" }
    ),
  listInvoices: (pageId: string) =>
    req<{ invoices: Invoice[] }>(
      `/api/pages/${encodeURIComponent(pageId)}/invoices`
    ),
  createPlan: (pageId: string, name: string, price: number, currency: string, interval: string) =>
    req<{ plan: SubscriptionPlan }>("/api/subscriptions/plans", {
      method: "POST",
      body: JSON.stringify({ pageId, name, price, currency, interval }),
    }),
  setPlanStatus: (id: string, status: string) =>
    req<{ plan: SubscriptionPlan }>(`/api/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  listPlans: (pageId: string) =>
    req<{ plans: SubscriptionPlan[] }>(
      `/api/pages/${encodeURIComponent(pageId)}/subscriptions`
    ),
  simulateWebhook: (type: string, orderId: string) =>
    req<{ ok: boolean; event: string; order: Order }>("/api/webhooks/simulate", {
      method: "POST",
      body: JSON.stringify({ type, orderId }),
    }),
  agentSell: (args: {
    sessionId?: string;
    pageId?: string;
    productId?: string;
    buyerName?: string;
    buyerMessage: string;
    minPrice?: number;
    maxPrice?: number;
  }) =>
    req<{ session: AgentSession; reply: string }>("/api/agent/sell", {
      method: "POST",
      body: JSON.stringify(args),
    }),
  getSession: (sid: string) =>
    req<{ session: AgentSession }>(`/api/agent/${encodeURIComponent(sid)}`),
  listSessions: (pageId: string) =>
    req<{ sessions: AgentSession[] }>(
      `/api/pages/${encodeURIComponent(pageId)}/agent`
    ),
  confirmSession: (sid: string) =>
    req<{ session: AgentSession; order: Order; paypal: string }>(
      `/api/agent/${encodeURIComponent(sid)}/confirm`,
      { method: "POST" }
    ),
  declineSession: (sid: string) =>
    req<{ session: AgentSession }>(
      `/api/agent/${encodeURIComponent(sid)}/decline`,
      { method: "POST" }
    ),
  askSupport: (pageId: string, question: string) =>
    req<{ answer: string; engine: string }>("/api/support/ask", {
      method: "POST",
      body: JSON.stringify({ pageId, question }),
    }),
  suggestPrice: (category: string, description: string, currency: string) =>
    req<PriceSuggestion>("/api/pricing/suggest", {
      method: "POST",
      body: JSON.stringify({ category, description, currency }),
    }),
  getStats: () => req<{ stats: Stats }>("/api/stats"),
};

export interface Coupon {
  code: string;
  pageId: string;
  percentOff: number;
  maxUses: number;
  usedCount: number;
  createdAt: string;
}
export interface DisputeDraft {
  subject: string;
  message: string;
  tone: string;
  engine: string;
}
export interface PageStats {
  pageId: string;
  title: string;
  views: number;
  orders: number;
  revenue: number;
  currency: string;
  conversion: number;
}
export interface Stats {
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
}
