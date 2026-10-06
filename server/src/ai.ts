// Vendora Pay AI — AI copy engine.
// Any OpenAI-compatible API when AI_API_KEY is set (Nebius, xAI Grok, …);
// otherwise an honest smart template. Every function reports which engine
// produced the output so the UI can label it truthfully.

import type { Invoice, Page, Product } from "./store.js";

// Generic provider config; NEBIUS_* kept as backward-compatible fallback.
const AI_KEY = process.env.AI_API_KEY ?? process.env.NEBIUS_API_KEY ?? "";
const AI_URL =
  process.env.AI_API_URL ??
  process.env.NEBIUS_API_URL ??
  "https://api.tokenfactory.nebius.com/v1";
const AI_MODEL =
  process.env.AI_MODEL ??
  process.env.NEBIUS_MODEL ??
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
// Human-readable provider name for honest UI labeling, e.g. "nebius", "grok".
export const AI_PROVIDER = process.env.AI_PROVIDER ?? "nebius";

export type AIEngine = string; // provider name, or "template"

export function aiMode(): AIEngine {
  return AI_KEY ? AI_PROVIDER : "template";
}

async function aiJSON<T>(prompt: string): Promise<T | null> {
  const r = await aiChatJSON<T>(prompt);
  return r?.data ?? null;
}

/**
 * Generic JSON chat call. Returns null when no key is set or on any failure.
 * Exported for the agentic-salesperson brain (NebiusBrain). The returned
 * `engine` names the provider ONLY when a real API call succeeded.
 */
export async function aiChatJSON<T>(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
): Promise<{ data: T; engine: AIEngine } | null> {
  if (!AI_KEY) return null;
  try {
    const res = await fetch(`${AI_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: opts?.maxTokens ?? 900,
        temperature: opts?.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 30000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return { data: JSON.parse(raw.slice(start, end + 1)) as T, engine: AI_PROVIDER };
  } catch {
    return null;
  }
}

// ---------- AI Page Builder ----------

export interface BuiltPage {
  title: string;
  tagline: string;
  category: string;
  themeColor: string;
  currency: string;
  products: Array<{
    name: string;
    description: string;
    price: number;
    minPrice: number;
    faq: Array<{ q: string; a: string }>;
  }>;
  engine: AIEngine;
}

const CATEGORY_HINTS: Array<{ match: RegExp; category: string; color: string }> = [
  { match: /logo|design|brand|illustrat|figma|ui/i, category: "design", color: "#7c3aed" },
  { match: /coach|consult|mentor|lesson|tutor|course/i, category: "coaching", color: "#0ea5e9" },
  { match: /candle|soap|craft|handmade|jewel|art\b/i, category: "crafts", color: "#f59e0b" },
  { match: /music|beat|mix|song|audio/i, category: "music", color: "#ec4899" },
  { match: /photo|video|edit/i, category: "media", color: "#10b981" },
  { match: /write|copy|blog|content/i, category: "writing", color: "#6366f1" },
  { match: /code|app|web|software|dev/i, category: "dev", color: "#22d3ee" },
];

function templateBuild(
  description: string,
  sellerName: string,
  currency: string
): BuiltPage {
  const desc = description.trim();
  const priceMatch = desc.match(/\$?\s?(\d+(?:\.\d{1,2})?)/);
  const price = priceMatch ? Math.max(1, Number(priceMatch[1])) : 49;
  const hint =
    CATEGORY_HINTS.find((h) => h.match.test(desc)) ??
    ({ category: "services", color: "#8b5cf6" } as { category: string; color: string });

  // Title: first meaningful chunk of the description
  const firstSentence = desc.split(/[.\n]/)[0].slice(0, 60);
  const name =
    sellerName.trim() ||
    "Your Studio";
  const title = `${cap(name)} — ${hint.category[0].toUpperCase()}${hint.category.slice(1)} Services`;
  void firstSentence;

  const productName = inferProductName(desc, hint.category);
  return {
    title,
    tagline: desc.slice(0, 140),
    category: hint.category,
    themeColor: hint.color,
    currency,
    products: [
      {
        name: productName,
        description: desc.slice(0, 280),
        price,
        minPrice: Math.max(1, Math.round(price * 0.7)),
        faq: [
          {
            q: "How do I pay?",
            a: "Securely through PayPal — cards and PayPal balance accepted, worldwide.",
          },
          {
            q: "What happens after I pay?",
            a: `The seller (${name}) gets notified instantly and starts on your order.`,
          },
          {
            q: "Can I get a refund?",
            a: "If the work hasn't started, full refund — just ask via the support chat below.",
          },
        ],
      },
    ],
    engine: "template",
  };
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function inferProductName(desc: string, category: string): string {
  const m = desc.match(/(?:i sell|selling|offer|offering)\s+([^.,\n]{3,50})/i);
  if (m) return cap(m[1].trim());
  const words = desc.split(/\s+/).slice(0, 4).join(" ");
  return cap(words) || `${cap(category)} Service`;
}

export async function buildPageFromChat(
  description: string,
  sellerName: string,
  currency: string
): Promise<BuiltPage> {
  const ai = await aiJSON<{
    title?: string;
    tagline?: string;
    category?: string;
    themeColor?: string;
    products?: Array<{
      name?: string;
      description?: string;
      price?: number;
      minPrice?: number;
      faq?: Array<{ q?: string; a?: string }>;
    }>;
  }>(
    `You build payment pages for freelancers. Seller says: "${description.slice(0, 500)}"\n` +
      `Return ONLY JSON: {"title":"...","tagline":"...","category":"...","themeColor":"#hex","products":[{"name":"...","description":"...","price":number,"minPrice":number (negotiation floor, ~70% of price),"faq":[{"q":"...","a":"..."}]}]}. ` +
      `1-2 products. Prices as plain numbers (no currency symbols). themeColor a vibrant hex.`
  );
  if (ai?.title && Array.isArray(ai.products) && ai.products.length > 0) {
    return {
      title: String(ai.title).slice(0, 80),
      tagline: String(ai.tagline ?? description).slice(0, 160),
      category: String(ai.category ?? "services").slice(0, 30),
      themeColor: /^#[0-9a-fA-F]{6}$/.test(String(ai.themeColor ?? ""))
        ? String(ai.themeColor)
        : "#8b5cf6",
      currency,
      products: ai.products.slice(0, 3).map((p) => ({
        name: String(p.name ?? "Service").slice(0, 80),
        description: String(p.description ?? description).slice(0, 300),
        price: Math.max(1, Number(p.price) || 49),
        minPrice: Math.max(1, Number(p.minPrice) || 35),
        faq: (p.faq ?? [])
          .slice(0, 4)
          .map((f) => ({ q: String(f.q ?? "").slice(0, 140), a: String(f.a ?? "").slice(0, 300) }))
          .filter((f) => f.q && f.a),
      })),
      engine: AI_PROVIDER,
    };
  }
  return templateBuild(description, sellerName, currency);
}

// ---------- Smart invoice drafting ----------

export interface DraftedInvoice {
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  notes: string;
  engine: AIEngine;
}

export async function draftInvoice(
  product: Product,
  buyerEmail: string,
  sellerName: string
): Promise<DraftedInvoice> {
  const ai = await aiJSON<{ items?: Array<{ name?: string; quantity?: number; unitPrice?: number }>; notes?: string }>(
    `Draft a PayPal invoice for: product "${product.name}" ($${product.price} ${product.currency}), ` +
      `description: "${product.description.slice(0, 200)}", buyer ${buyerEmail}, seller ${sellerName}. ` +
      `Return ONLY JSON: {"items":[{"name":"...","quantity":1,"unitPrice":number}],"notes":"polite 1-2 line note with payment terms"}`
  );
  if (ai?.items?.length) {
    return {
      items: ai.items.slice(0, 5).map((i) => ({
        name: String(i.name ?? product.name).slice(0, 120),
        quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
        unitPrice: Math.max(0.5, Number(i.unitPrice) || product.price),
      })),
      notes: String(ai.notes ?? "").slice(0, 400),
      engine: AI_PROVIDER,
    };
  }
  return {
    items: [{ name: product.name, quantity: 1, unitPrice: product.price }],
    notes: `Thanks for choosing ${sellerName}! Payment due within 7 days via PayPal. Questions? Just reply to this invoice.`,
    engine: "template",
  };
}

// ---------- AI payment reminders ----------

export async function draftReminder(
  invoice: Invoice,
  sellerName: string
): Promise<{ text: string; engine: AIEngine }> {
  const overdueDays = Math.max(
    0,
    Math.round((Date.now() - new Date(invoice.dueDate).getTime()) / 864e5)
  );
  const ai = await aiJSON<{ text?: string }>(
    `Write a polite, short payment reminder email (under 80 words). Seller ${sellerName}, ` +
      `buyer owes ${invoice.amount} ${invoice.currency} for "${invoice.productName}", ` +
      `${overdueDays} days overdue. Friendly tone, one clear pay CTA, no threats. Return ONLY JSON: {"text":"..."}.`
  );
  if (ai?.text) return { text: ai.text.slice(0, 600), engine: AI_PROVIDER };
  return {
    text:
      `Hi! Just a friendly nudge — invoice for "${invoice.productName}" ` +
      `(${invoice.amount} ${invoice.currency}) was due ${overdueDays} day(s) ago. ` +
      `You can pay securely via PayPal anytime. Thanks so much, ${sellerName}!`,
    engine: "template",
  };
}

// ---------- Pricing coach ----------

export interface PriceSuggestion {
  min: number;
  recommended: number;
  max: number;
  rationale: string;
  engine: AIEngine;
}

export async function suggestPrice(
  category: string,
  description: string,
  currency: string
): Promise<PriceSuggestion> {
  const ai = await aiJSON<{ min?: number; recommended?: number; max?: number; rationale?: string }>(
    `As a pricing coach for freelancers: category "${category}", offering: "${description.slice(0, 200)}", currency ${currency}. ` +
      `Suggest a fair price range for a global market. Return ONLY JSON: {"min":number,"recommended":number,"max":number,"rationale":"one short line"}.`
  );
  if (ai && Number(ai.recommended) > 0) {
    return {
      min: Math.max(1, Math.round(Number(ai.min) || 20)),
      recommended: Math.round(Number(ai.recommended)),
      max: Math.max(1, Math.round(Number(ai.max) || 100)),
      rationale: String(ai.rationale ?? "").slice(0, 200),
      engine: AI_PROVIDER,
    };
  }
  // Template: heuristic bands by category (honest heuristic, labeled)
  const base: Record<string, [number, number, number]> = {
    design: [25, 50, 150],
    coaching: [40, 99, 300],
    crafts: [15, 35, 90],
    music: [20, 49, 120],
    media: [30, 75, 200],
    writing: [20, 45, 120],
    dev: [50, 150, 500],
  };
  const [mn, rec, mx] = base[category.toLowerCase()] ?? [20, 49, 150];
  return {
    min: mn,
    recommended: rec,
    max: mx,
    rationale:
      "Heuristic band for this category — adjust for your experience and delivery time.",
    engine: "template",
  };
}

// ---------- AI dispute helper ----------

export interface DisputeDraft {
  subject: string;
  message: string;
  tone: string;
  engine: string;
}

export async function draftDisputeResponse(
  sellerName: string,
  productName: string,
  amount: number,
  currency: string,
  buyerName: string,
  disputeReason: string,
  sellerNotes: string
): Promise<DisputeDraft> {
  const ai = await aiJSON<{ subject?: string; message?: string }>(
    `You are a professional dispute-resolution assistant for an online seller named "${sellerName}". ` +
      `A buyer "${buyerName}" opened a PayPal dispute about "${productName}" (${amount} ${currency}). ` +
      `Buyer's stated reason: "${disputeReason.slice(0, 300)}". ` +
      `Seller's notes: "${sellerNotes.slice(0, 300)}". ` +
      `Write a calm, professional, factual response the seller can send to PayPal / the buyer: acknowledge the concern, state the facts, propose a fair resolution (refund/partial refund/redelivery). ` +
      `Keep it under 150 words, no legal threats. Return ONLY JSON: {"subject":"short subject line","message":"the response text"}.`
  );
  if (ai && ai.message) {
    return {
      subject: String(ai.subject ?? "Re: dispute — let's resolve this fairly").slice(0, 120),
      message: String(ai.message).slice(0, 1500),
      tone: "professional",
      engine: AI_PROVIDER,
    };
  }
  // Template fallback (honest label)
  return {
    subject: `Re: dispute on "${productName}" — proposed resolution`,
    message:
      `Hi ${buyerName},\n\nThanks for reaching out. I take every dispute seriously. ` +
      `Regarding your concern ("${disputeReason.slice(0, 120)}"): ` +
      `${sellerNotes ? `here's my side — ${sellerNotes.slice(0, 200)}. ` : ""}` +
      `I'd like to resolve this fairly: I'm happy to offer a full refund or redeliver the work to your satisfaction, whichever you prefer. ` +
      `Please reply within 48 hours so we can close this out.\n\nBest,\n${sellerName}`,
    tone: "professional",
    engine: "template",
  };
}

// ---------- AI support bot (buyer questions on the public page) ----------

export async function supportAnswer(
  page: Page,
  question: string
): Promise<{ answer: string; engine: AIEngine }> {
  const q = question.toLowerCase();
  // 1. Direct FAQ hit (deterministic, always first)
  for (const p of page.products) {
    for (const f of p.faq) {
      const words = f.q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      if (words.some((w) => q.includes(w))) {
        return { answer: f.a, engine: "template" };
      }
    }
  }
  // 2. Product/price questions answered from real page data
  const money = /price|cost|much|charge|fee/i.test(q);
  for (const p of page.products) {
    if (q.includes(p.name.toLowerCase().split(" ")[0]) || money) {
      const target = q.includes(p.name.toLowerCase().split(" ")[0]) ? p : page.products[0];
      if (money)
        return {
          answer: `"${target.name}" is ${target.price} ${target.currency}. ${target.description.slice(0, 160)}`,
          engine: "template",
        };
    }
  }
  // 3. AI paraphrase over page data
  const ai = await aiJSON<{ answer?: string }>(
    `You are the support bot for "${page.title}" (${page.tagline}). Products: ` +
      page.products
        .map((p) => `"${p.name}": ${p.price} ${p.currency} — ${p.description.slice(0, 120)}`)
        .join(" | ") +
      `. Buyer asks: "${question.slice(0, 200)}". Answer helpfully in 1-2 sentences from the product info only. ` +
      `If the info isn't there, say so honestly and suggest asking the seller. Return ONLY JSON: {"answer":"..."}.`
  );
  if (ai?.answer) return { answer: ai.answer.slice(0, 400), engine: AI_PROVIDER };
  return {
    answer:
      "I don't have that detail on this page — try asking the seller directly, they usually reply fast!",
    engine: "template",
  };
}
