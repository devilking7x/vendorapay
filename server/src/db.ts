// Vendora Pay AI — Supabase persistence adapter.
// Uses the Supabase REST API via native fetch (no extra dependencies).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role — server-side only).
// If either is missing, every function degrades gracefully (returns null / no-op)
// and the store falls back to local JSON file persistence.

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";

export function supabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;
}

const TABLE = "kv_store";

async function sb(
  path: string,
  init?: { method?: string; body?: string }
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: init?.body,
    signal: AbortSignal.timeout(15000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, json };
}

/** Load the full store dump previously saved under `key`. Returns null if missing/error. */
export async function sbLoad(key: string): Promise<Record<string, unknown> | null> {
  if (!supabaseConfigured()) return null;
  try {
    const r = await sb(`/${TABLE}?key=eq.${encodeURIComponent(key)}&select=value`);
    if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) return null;
    const v = (r.json[0] as { value: unknown }).value;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Upsert the full store dump under `key`. Returns true on success. */
export async function sbSave(key: string, value: Record<string, unknown>): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const r = await sb(`/${TABLE}`, {
      method: "POST",
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
