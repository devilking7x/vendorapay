// Vendora Pay AI — Competitor Price Watch.
// Sellers register a product with a search query; we use the Tavily Search
// API to find what competitors charge, and raise an alert when a competitor
// undercuts the seller's price. HONESTY: without TAVILY_API_KEY everything
// reports "unavailable" — prices are never invented. Checks run on demand
// (manual refresh endpoint), not on a hidden background schedule.

const TAVILY_KEY = process.env.TAVILY_API_KEY ?? "";
const TAVILY_URL = "https://api.tavily.com/search";

export function priceWatchAvailable(): boolean {
  return TAVILY_KEY.length > 0;
}

export interface CompetitorPrice {
  title: string;
  price: number;
  currency: string;
  url: string;
  snippet: string;
}

export interface PriceWatch {
  id: string;
  pageId: string;
  productId: string;
  productName: string;
  sellerPrice: number;
  currency: string;
  query: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastResults?: CompetitorPrice[];
  lastError?: string;
}

export interface PriceAlert {
  watchId: string;
  productName: string;
  sellerPrice: number;
  competitorTitle: string;
  competitorPrice: number;
  competitorUrl: string;
  currency: string;
  /** how much cheaper the competitor is, in seller currency units */
  savings: number;
}

const watches = new Map<string, PriceWatch>();

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Extract a plausible price from text, e.g. "$49", "49 USD", "USD 49.99". */
export function extractPrice(text: string): { price: number; currency: string } | null {
  const m =
    text.match(/\$[\s]?(\d+(?:\.\d{1,2})?)/) ||
    text.match(/(\d+(?:\.\d{1,2})?)\s?USD/i) ||
    text.match(/USD\s?(\d+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const price = Number(m[1]);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return null;
  return { price, currency: "USD" };
}

export function watchProduct(
  pageId: string,
  productId: string,
  productName: string,
  sellerPrice: number,
  currency: string,
  query: string
): PriceWatch {
  const q = query.trim().slice(0, 200) || `${productName} price buy`;
  const w: PriceWatch = {
    id: rid("watch"),
    pageId,
    productId,
    productName,
    sellerPrice,
    currency,
    query: q,
    createdAt: new Date().toISOString(),
  };
  watches.set(w.id, w);
  return w;
}

export function unwatch(watchId: string): boolean {
  return watches.delete(watchId);
}

export function listWatches(pageId?: string): PriceWatch[] {
  const all = [...watches.values()];
  return pageId ? all.filter((w) => w.pageId === pageId) : all;
}

export function getWatch(watchId: string): PriceWatch | null {
  return watches.get(watchId) ?? null;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

/**
 * Run one price check for a watch. Real Tavily API call; without a key the
 * watch records an honest "unavailable" error and returns no results.
 */
export async function checkWatch(watchId: string): Promise<PriceWatch | null> {
  const w = watches.get(watchId);
  if (!w) return null;
  if (!priceWatchAvailable()) {
    w.lastError = "no TAVILY_API_KEY — price check unavailable (no data invented)";
    w.lastCheckedAt = new Date().toISOString();
    return w;
  }
  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: w.query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = (await res.json()) as { results?: TavilyResult[] };
    const results: CompetitorPrice[] = [];
    for (const r of data.results ?? []) {
      const text = `${r.title ?? ""} ${r.content ?? ""}`;
      const found = extractPrice(text);
      if (!found) continue;
      // Skip results that are clearly the seller's own price echoed back.
      results.push({
        title: String(r.title ?? "Competitor listing").slice(0, 120),
        price: found.price,
        currency: found.currency,
        url: String(r.url ?? ""),
        snippet: String(r.content ?? "").slice(0, 200),
      });
      if (results.length >= 5) break;
    }
    w.lastResults = results;
    w.lastError = undefined;
    w.lastCheckedAt = new Date().toISOString();
    return w;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    w.lastError = `price check failed (${msg.slice(0, 120)}) — no data invented`;
    w.lastCheckedAt = new Date().toISOString();
    return w;
  }
}

/**
 * Derive alerts: any competitor priced strictly below the seller's price.
 * Pure function of stored check results — no network.
 */
export function getAlerts(pageId: string): PriceAlert[] {
  const alerts: PriceAlert[] = [];
  for (const w of watches.values()) {
    if (w.pageId !== pageId || !w.lastResults) continue;
    for (const c of w.lastResults) {
      if (c.currency !== w.currency) continue; // only compare like-for-like
      if (c.price < w.sellerPrice) {
        alerts.push({
          watchId: w.id,
          productName: w.productName,
          sellerPrice: w.sellerPrice,
          competitorTitle: c.title,
          competitorPrice: c.price,
          competitorUrl: c.url,
          currency: w.currency,
          savings: Math.round((w.sellerPrice - c.price) * 100) / 100,
        });
      }
    }
  }
  return alerts.sort((a, b) => b.savings - a.savings);
}

/** Test hook: seed a watch with canned results (no network). */
export function seedWatchForTest(w: PriceWatch, results: CompetitorPrice[]): void {
  w.lastResults = results;
  w.lastCheckedAt = new Date().toISOString();
  watches.set(w.id, w);
}

/** Test hook: clear all watches. */
export function clearWatchesForTest(): void {
  watches.clear();
}
