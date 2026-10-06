// Vendora Pay AI — Photo → Listing (multimodal product understanding).
// Upload a product photo, get a drafted listing (title, description, price,
// category). Uses a vision-capable chat model via the configured AI provider
// when a key is set. HONESTY: without a key (or on any vision failure) this
// returns {ai:false} with an honest error — it NEVER invents a description.

import { aiMode, AI_PROVIDER } from "./ai.js";

export interface PhotoListing {
  title: string;
  description: string;
  suggestedPrice: number;
  category: string;
  /** true only when a real vision API call produced the listing */
  ai: boolean;
  /** honest engine/error label */
  engine: string;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function validatePhotoUpload(
  mimeType: string,
  byteLength: number
): string | null {
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return `unsupported file type "${mimeType}" — upload a JPEG, PNG, WebP or GIF photo`;
  }
  if (byteLength > MAX_BYTES) {
    return `photo is ${(byteLength / 1024 / 1024).toFixed(1)}MB — max 5MB`;
  }
  if (byteLength === 0) {
    return "empty photo upload";
  }
  return null;
}

/**
 * Describe a product photo and draft a listing.
 * imageBase64: raw base64 (no data: prefix). Never fakes output.
 */
export async function describeProduct(
  imageBase64: string,
  mimeType: string
): Promise<PhotoListing> {
  const fail = (engine: string): PhotoListing => ({
    title: "",
    description: "",
    suggestedPrice: 0,
    category: "",
    ai: false,
    engine,
  });

  if (aiMode() === "template") {
    return fail("no AI key — vision unavailable (listing not generated)");
  }
  return describeProductVision(imageBase64, mimeType, fail);
}

async function describeProductVision(
  imageBase64: string,
  mimeType: string,
  fail: (engine: string) => PhotoListing
): Promise<PhotoListing> {
  const AI_KEY = process.env.AI_API_KEY ?? process.env.NEBIUS_API_KEY ?? "";
  const AI_URL = (
    process.env.AI_API_URL ??
    process.env.NEBIUS_API_URL ??
    "https://api.tokenfactory.nebius.com/v1"
  ).replace(/\/+$/, "");
  const AI_MODEL =
    process.env.AI_VISION_MODEL ??
    process.env.AI_MODEL ??
    process.env.NEBIUS_MODEL ??
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
  if (!AI_KEY) return fail("no AI key — vision unavailable (listing not generated)");
  try {
    const res = await fetch(`${AI_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `You are a product-listing expert for freelancers selling online. Look at this product photo and draft a listing. ` +
                  `Return ONLY JSON: {"title":"short product name (max 60 chars)","description":"2-3 sentence enticing description (max 280 chars)","suggestedPrice":number (fair USD market price, plain number),"category":"one of: design, coaching, crafts, music, media, writing, dev, services"}. ` +
                  `If you cannot see a product clearly, return {"title":"","description":"","suggestedPrice":0,"category":""}.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 700,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      return fail(
        `vision model request failed (HTTP ${res.status}) — listing not generated`
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return fail("vision model returned no usable listing — not generated");
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      title?: unknown;
      description?: unknown;
      suggestedPrice?: unknown;
      category?: unknown;
    };
    const title = String(parsed.title ?? "").slice(0, 60);
    const description = String(parsed.description ?? "").slice(0, 280);
    const suggestedPrice = Math.max(0, Math.round(Number(parsed.suggestedPrice) || 0));
    const category = String(parsed.category ?? "").slice(0, 30);
    if (!title || !description) {
      return fail("vision model could not identify a product — listing not generated");
    }
    return {
      title,
      description,
      suggestedPrice,
      category: category || "services",
      ai: true,
      engine: AI_PROVIDER, // set ONLY on real API success
    };
  } catch {
    return fail("vision request failed — listing not generated");
  }
}
