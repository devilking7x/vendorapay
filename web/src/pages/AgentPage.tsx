import { useEffect, useState } from "react";
import { api, type AgentSession, type Page } from "../api";

export default function AgentPage({
  nav,
  initialPageId,
}: {
  nav: (h: string) => void;
  initialPageId?: string;
}) {
  const [pages, setPages] = useState<Array<{ id: string; title: string }>>([]);
  const [pageId, setPageId] = useState(initialPageId ?? "");
  const [page, setPage] = useState<Page | null>(null);
  const [productId, setProductId] = useState("");
  const [buyer, setBuyer] = useState("Maya");
  const [minP, setMinP] = useState("");
  const [maxP, setMaxP] = useState("");
  const [session, setSession] = useState<AgentSession | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showSteps, setShowSteps] = useState(true);

  useEffect(() => {
    api
      .listPages()
      .then((r) => {
        setPages(r.pages.map((p) => ({ id: p.id, title: p.title })));
        // If URL has a page id, honor it — fetch directly even if not in list yet
        if (initialPageId && !pageId) {
          setPageId(initialPageId);
          // Try direct fetch in case list is stale (ephemeral storage)
          api.getPage(initialPageId).then((pr) => {
            setPage(pr.page);
            const first = pr.page.products[0];
            if (first) {
              setProductId(first.id);
              setMinP(String(first.minPrice));
              setMaxP(String(first.price));
            }
          }).catch(() => {
            setErr("This storefront is no longer available — demo data resets periodically. Build a new one.");
          });
          return;
        }
        const pick = r.pages.find((p) => p.id === initialPageId)?.id ?? r.pages[0]?.id ?? "";
        if (pick && !pageId) setPageId(pick);
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pageId) return;
    api
      .getPage(pageId)
      .then((r) => {
        setPage(r.page);
        const first = r.page.products[0];
        if (first && !productId) {
          setProductId(first.id);
          setMinP(String(first.minPrice));
          setMaxP(String(first.price));
        }
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => {
    const p = page?.products.find((x) => x.id === productId);
    if (p) {
      setMinP(String(p.minPrice));
      setMaxP(String(p.price));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const start = async () => {
    if (!pageId || !productId) {
      setErr("Pick a storefront and a product first.");
      return;
    }
    setBusy(true);
    setErr("");
    setSession(null);
    try {
      const r = await api.agentSell({
        pageId,
        productId,
        buyerName: buyer || "Buyer",
        buyerMessage: "Hi! I'm interested — what's your best price?",
        minPrice: Number(minP) || undefined,
        maxPrice: Number(maxP) || undefined,
      });
      setSession(r.session);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!msg.trim() || !session || busy) return;
    const m = msg.trim();
    setMsg("");
    setBusy(true);
    try {
      const r = await api.agentSell({ sessionId: session.id, buyerMessage: m });
      setSession(r.session);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const r = await api.confirmSession(session.id);
      setSession(r.session);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const r = await api.declineSession(session.id);
      setSession(r.session);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-display font-extrabold text-3xl mb-2">🤖 Agentic Salesperson</h1>
      <p className="text-white/60 mb-6 text-sm">
        You play the <strong className="text-white">buyer</strong>; the agent negotiates for the
        seller inside the bounds you set. Nothing is charged until the seller confirms.
      </p>

      {!session && (
        <div className="card space-y-4">
          {pages.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-white/60 mb-4">No storefront yet.</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => nav("#/build")} className="btn-primary">🛠️ Build one</button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-white/70 block mb-1">Storefront</label>
                  <select className="input" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id} className="bg-ink">{p.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-white/70 block mb-1">Product</label>
                  <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                    {(page?.products ?? []).map((p) => (
                      <option key={p.id} value={p.id} className="bg-ink">
                        {p.name} — {p.price} {p.currency}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-white/70 block mb-1">Buyer name (you)</label>
                  <input className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm text-white/70 block mb-1">Min price (floor)</label>
                  <input className="input" type="number" value={minP} onChange={(e) => setMinP(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm text-white/70 block mb-1">Max price (ceiling)</label>
                  <input className="input" type="number" value={maxP} onChange={(e) => setMaxP(e.target.value)} />
                </div>
              </div>
              {err && <p className="text-red-300 text-sm">{err}</p>}
              <button onClick={start} disabled={busy} className="btn-primary w-full">
                {busy ? "Starting…" : "🚀 Start the sale"}
              </button>
              <p className="text-xs text-white/40">
                🛡️ Guardrails: the agent can only agree inside [{minP || "…"}, {maxP || "…"}] and
                can never create a charge — only the seller's Confirm button does that.
              </p>
            </>
          )}
        </div>
      )}

      {session && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <p className="font-medium text-sm">
                {session.buyerName} × {session.productName} · bounds [{session.minPrice},{" "}
                {session.maxPrice}] {session.currency}
              </p>
              <span className={`chip status-${session.state.toUpperCase()}`}>{session.state}</span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto mb-4">
              {session.messages.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-xl px-3 py-2 max-w-[90%] ${
                    m.role === "buyer"
                      ? "bg-mint/20 ml-auto"
                      : m.role === "system"
                        ? "bg-white/5 text-white/50 text-xs mx-auto text-center"
                        : "bg-white/10"
                  }`}
                >
                  {m.role === "agent" && <span className="text-mint">🤖 </span>}
                  {m.text}
                  {m.translatedText && (
                    <div className="mt-1.5 pt-1.5 border-t border-white/10">
                      <p className="text-xs text-white/70">
                        <span title={m.translationAI ? "Translated by AI" : "Translation unavailable — showing original"}>
                          🌐 {m.translationAI ? "" : "(original — translation unavailable) "}
                        </span>
                        {m.translatedText}
                      </p>
                    </div>
                  )}
                </div>
              ))}
              {busy && <p className="text-white/40 text-sm">agent thinking…</p>}
            </div>

            {session.state === "awaiting_seller_confirm" && session.pendingCharge && (
              <div className="bg-gold/10 border border-gold/30 rounded-xl p-3 mb-3">
                <p className="text-sm mb-2">
                  💰 <strong>Seller action needed:</strong> confirm the charge of{" "}
                  <strong>
                    {session.pendingCharge.amount} {session.pendingCharge.currency}
                  </strong>{" "}
                  (or decline — nothing moves without this).
                </p>
                <div className="flex gap-2">
                  <button onClick={confirm} disabled={busy} className="btn-primary !px-4 !py-2 text-sm">
                    ✅ Confirm charge
                  </button>
                  <button onClick={decline} disabled={busy} className="btn-ghost !px-4 !py-2 text-sm">
                    Decline
                  </button>
                </div>
              </div>
            )}

            {(session.state === "active") && (
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="Try: &quot;I'll pay $10&quot; or &quot;deal!&quot;"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                />
                <button onClick={send} disabled={busy} className="btn-primary px-4">
                  ➤
                </button>
              </div>
            )}
            {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
          </div>

          <div className="card">
            <button
              onClick={() => setShowSteps(!showSteps)}
              className="font-display font-bold text-sm text-mint"
            >
              {showSteps ? "▾" : "▸"} 🧠 Agent reasoning — step by step ({session.steps.length})
            </button>
            {showSteps && (
              <div className="mt-3 space-y-2">
                {session.steps.map((st) => (
                  <div key={st.step} className="bg-ink/50 rounded-lg p-3 text-xs">
                    <p className="text-white/80 mb-1">
                      <strong>Step {st.step} — thinking:</strong> {st.reasoning}
                    </p>
                    <p className="text-mint">→ action: {st.action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setSession(null);
                setMsg("");
              }}
              className="btn-ghost"
            >
              ← New sale
            </button>
            <button onClick={() => nav("#/dashboard")} className="btn-ghost">
              📊 Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
