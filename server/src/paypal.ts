// Vendora Pay AI — PayPal client.
// Keys: free sandbox REST app at https://developer.paypal.com (never commit, never chat).
// PAYPAL_MOCK=1 -> simulated end-to-end flow, no network (demo/testing).
// PAYPAL_MOCK=0 + PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET -> real sandbox REST.

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? "";
const SECRET = process.env.PAYPAL_CLIENT_SECRET ?? "";
const MOCK = process.env.PAYPAL_MOCK === "1";
const BASE = (process.env.PAYPAL_API_URL ?? "https://api-m.sandbox.paypal.com").replace(
  /\/+$/,
  ""
);

export type PayPalMode = "mock" | "live" | "none";

export function paypalMode(): PayPalMode {
  if (MOCK) return "mock";
  return CLIENT_ID && SECRET ? "live" : "none";
}

export function paypalReady(): boolean {
  return MOCK || (!!CLIENT_ID && !!SECRET);
}

export interface PayPalOrder {
  id: string;
  status: string;
  /** present in mock mode: a fake approval URL for the demo checkout */
  approveUrl?: string;
  amount: number;
  currency: string;
}

export interface PayPalInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface PayPalPlan {
  id: string;
  status: string;
}

// ---------- real sandbox REST ----------

let tokenCache: { token: string; at: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 8 * 60 * 1000) return tokenCache.token;
  const basic = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`PayPal auth ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal auth: no token");
  tokenCache = { token: data.access_token, at: Date.now() };
  return data.access_token;
}

async function rest(
  method: string,
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayPal ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

// ---------- resilience: retry with backoff + circuit breaker ----------

export class PayPalError extends Error {
  readonly status?: number;
  readonly transient: boolean;
  constructor(message: string, opts?: { status?: number; transient?: boolean }) {
    super(message);
    this.name = "PayPalError";
    this.status = opts?.status;
    this.transient = opts?.transient ?? false;
  }
}

function retryDelaysMs(): number[] {
  const raw = process.env.PAYPAL_RETRY_DELAYS_MS;
  if (raw) {
    const ds = raw
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (ds.length > 0) return ds.slice(0, 5);
  }
  return [1000, 2000, 4000]; // exponential backoff
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Transient = worth retrying: HTTP 429 / 5xx, or a network-level failure. */
export function isTransientError(e: unknown): boolean {
  const msg = errMessage(e);
  if (/-> 429(?:\D|$)/.test(msg) || /-> 5\d\d(?:\D|$)/.test(msg)) return true;
  if (e instanceof TypeError) return true; // fetch network failure
  if (e instanceof Error && e.name === "AbortError") return true; // timeout
  return false;
}

// Circuit breaker state: after repeated consecutive failures, fail fast
// for a cooldown instead of hammering PayPal.
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;

/** Test/ops hook: reset circuit-breaker state. */
export function resetPayPalCircuit(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function checkCircuit(label: string): void {
  if (Date.now() < circuitOpenUntil) {
    throw new PayPalError(
      `PayPal circuit breaker OPEN after ${consecutiveFailures} consecutive failures — ` +
        `refusing ${label} for ${Math.ceil((circuitOpenUntil - Date.now()) / 1000)}s. ` +
        `No charge attempted.`,
      { transient: true }
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run fn with exponential-backoff retry on transient failures.
 * Non-transient errors fail immediately. After retries are exhausted the
 * error is honest: no fake success, nothing charged. Exported for tests.
 */
export async function withPayPalRetry<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  checkCircuit(label);
  const delays = retryDelaysMs();
  let lastErr: unknown = null;
  let attempts = 0;
  for (let i = 0; i <= delays.length; i++) {
    attempts = i + 1;
    try {
      const out = await fn();
      consecutiveFailures = 0;
      return out;
    } catch (e) {
      lastErr = e;
      if (!isTransientError(e)) break;
      if (i === delays.length) break;
      const wait = delays[i];
      console.warn(
        `[paypal] ${label}: attempt ${attempts} failed (${errMessage(e).slice(0, 120)}); retrying in ${wait}ms`
      );
      await sleep(wait);
    }
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.warn(`[paypal] circuit breaker OPEN after ${consecutiveFailures} consecutive failures`);
  }
  const tried = attempts > 1 ? ` after ${attempts} attempts` : "";
  throw new PayPalError(
    `PayPal ${label} failed${tried}: ${errMessage(lastErr).slice(0, 200)}. ` +
      `No order was created — nothing was charged.`,
    { transient: isTransientError(lastErr) }
  );
}

/** Live REST call wrapped in retry + circuit breaker. */
function liveRest(
  method: string,
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  return withPayPalRetry(`${method} ${path}`, () => rest(method, path, body));
}

// ---------- public API (mock or live behind the env flag) ----------

/** Create an order (intent CAPTURE). */
export async function createOrder(
  amount: number,
  currency: string,
  description: string
): Promise<PayPalOrder> {
  if (MOCK) {
    const id = rid("MOCK-ORDER");
    return {
      id,
      status: "CREATED",
      approveUrl: `#mock-approve/${id}`,
      amount,
      currency,
    };
  }
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  const data = await liveRest("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code: currency, value: amount.toFixed(2) },
        description: description.slice(0, 120),
      },
    ],
  });
  const links = (data.links ?? []) as Array<{ rel?: string; href?: string }>;
  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? "CREATED"),
    approveUrl: links.find((l) => l.rel === "approve")?.href,
    amount,
    currency,
  };
}

/** Capture an approved order. */
export async function captureOrder(
  orderId: string
): Promise<{ id: string; status: string }> {
  if (MOCK) return { id: orderId, status: "COMPLETED" };
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  const data = await liveRest("POST", `/v2/checkout/orders/${orderId}/capture`, {});
  return { id: String(data.id ?? orderId), status: String(data.status ?? "COMPLETED") };
}

/** Create an invoice DRAFT (AI fills the line items via the caller). */
export async function createInvoiceDraft(args: {
  buyerEmail: string;
  currency: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  notes: string;
  dueDate: string; // YYYY-MM-DD
}): Promise<PayPalInvoice> {
  if (MOCK) {
    const total = args.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    return { id: rid("MOCK-INV"), status: "DRAFT", amount: total, currency: args.currency };
  }
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  const data = await liveRest("POST", "/v2/invoicing/invoices", {
    detail: {
      currency_code: args.currency,
      note: args.notes.slice(0, 400),
      payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: args.dueDate },
    },
    primary_recipients: [{ billing_info: { email_address: args.buyerEmail } }],
    items: args.items.map((i) => ({
      name: i.name.slice(0, 120),
      quantity: String(i.quantity),
      unit_amount: { currency_code: args.currency, value: i.unitPrice.toFixed(2) },
    })),
  });
  const href = String((data as { href?: string }).href ?? "");
  const id = href.split("/").pop() ?? "";
  return { id, status: "DRAFT", amount: 0, currency: args.currency };
}

/** Send an invoice to the buyer. */
export async function sendInvoice(invoiceId: string): Promise<{ id: string; status: string }> {
  if (MOCK) return { id: invoiceId, status: "SENT" };
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  await liveRest("POST", `/v2/invoicing/invoices/${invoiceId}/send`, {
    send_to_recipient: true,
  });
  return { id: invoiceId, status: "SENT" };
}

/** Create a subscription product + billing plan (retainers). */
export async function createSubscriptionPlan(args: {
  name: string;
  price: number;
  currency: string;
  interval: "MONTH" | "YEAR";
}): Promise<PayPalPlan> {
  if (MOCK) return { id: rid("MOCK-PLAN"), status: "ACTIVE" };
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  const product = await liveRest("POST", "/v1/catalogs/products", {
    name: args.name.slice(0, 120),
    type: "SERVICE",
  });
  const plan = await liveRest("POST", "/v1/billing/plans", {
    product_id: String(product.id ?? ""),
    name: args.name.slice(0, 120),
    billing_cycles: [
      {
        frequency: {
          interval_unit: args.interval === "MONTH" ? "MONTH" : "YEAR",
          interval_count: 1,
        },
        tenure_type: "REGULAR",
        sequence: 1,
        pricing_scheme: {
          fixed_price: {
            value: args.price.toFixed(2),
            currency_code: args.currency,
          },
        },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true },
  });
  return { id: String(plan.id ?? ""), status: String(plan.status ?? "ACTIVE") };
}

export interface PayPalRefund {
  id: string;
  status: string;
}

/**
 * Look up the PayPal capture ID for a captured order (needed for refunds).
 * Returns null when the order has no completed capture.
 */
export async function getCaptureIdForOrder(
  paypalOrderId: string
): Promise<string | null> {
  if (MOCK) {
    return paypalOrderId.startsWith("MOCK-") ? `MOCK-CAPTURE-${paypalOrderId.slice(5, 13)}` : null;
  }
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  const data = await liveRest("GET", `/v2/checkout/orders/${paypalOrderId}`, undefined);
  const units = (data.purchase_units ?? []) as Array<{
    payments?: { captures?: Array<{ id?: string; status?: string }> };
  }>;
  for (const u of units) {
    for (const c of u.payments?.captures ?? []) {
      if (c.id && c.status === "COMPLETED") return c.id;
    }
  }
  return null;
}

/**
 * Refund a captured payment. SELLER-APPROVAL is enforced by the caller
 * (returns.ts) — this function never decides on its own.
 * Honest: throws PayPalError on failure, never fakes a refund.
 */
export async function refundCapture(
  captureId: string,
  amount?: number,
  currency?: string
): Promise<PayPalRefund> {
  if (MOCK) {
    return { id: rid("MOCK-REFUND"), status: "COMPLETED" };
  }
  if (!CLIENT_ID || !SECRET) throw new Error("PAYPAL_CLIENT_ID/SECRET not configured");
  const body =
    amount !== undefined && currency
      ? { amount: { value: amount.toFixed(2), currency_code: currency } }
      : {};
  const data = await liveRest(
    "POST",
    `/v2/payments/captures/${captureId}/refund`,
    body
  );
  return { id: String(data.id ?? ""), status: String(data.status ?? "COMPLETED") };
}
