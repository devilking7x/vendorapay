import { useEffect, useState } from "react";
import { api, type Order, type Page, type Product } from "../api";

export default function Storefront({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [mode, setMode] = useState("");
  const [err, setErr] = useState("");
  const [buying, setBuying] = useState<Product | null>(null);
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [botQ, setBotQ] = useState("");
  const [botLog, setBotLog] = useState<Array<{ who: string; text: string }>>([]);
  const [botBusy, setBotBusy] = useState(false);
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPage(id)
      .then((r) => {
        setPage(r.page);
        setMode(r.paypal);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  const startCheckout = (p: Product) => {
    setBuying(p);
    setOrder(null);
    setErr("");
  };

  const createOrder = async () => {
    if (!buying || !page) return;
    if (!/.+@.+\..+/.test(email)) {
      setErr("Enter a valid email for the receipt.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await api.createOrder(page.id, buying.id, email);
      setOrder(r.order);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const r = await api.captureOrder(order.id);
      setOrder(r.order);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const askBot = async () => {
    if (!botQ.trim() || !page || botBusy) return;
    const q = botQ.trim();
    setBotQ("");
    setBotLog((l) => [...l, { who: "you", text: q }]);
    setBotBusy(true);
    try {
      const r = await api.askSupport(page.id, q);
      setBotLog((l) => [
        ...l,
        { who: "bot", text: `${r.answer}${r.engine === "nebius" ? " ✨" : ""}` },
      ]);
    } catch (e) {
      setBotLog((l) => [...l, { who: "bot", text: `Oops: ${(e as Error).message}` }]);
    } finally {
      setBotBusy(false);
    }
  };

  if (err && !page) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-red-300 mb-4">{err}</p>
        <button onClick={() => nav("#/build")} className="btn-primary">
          Build a storefront
        </button>
      </div>
    );
  }
  if (!page) return <p className="text-center py-16 text-white/50">Loading storefront…</p>;

  return (
    <div>
      {/* Hero */}
      <section
        className="px-4 py-12 text-center border-b border-white/10"
        style={{
          background: `linear-gradient(135deg, ${page.themeColor}33, transparent 60%)`,
        }}
      >
        <div className="max-w-3xl mx-auto">
          <p className="text-sm text-white/50 mb-2">by {page.sellerName}</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-5xl tracking-tight">
            {page.title}
          </h1>
          <p className="text-white/70 mt-3 max-w-xl mx-auto">{page.tagline}</p>
          <div className="flex gap-2 justify-center mt-4">
            <span className="chip">{page.category}</span>
            {mode === "mock" && (
              <span className="chip bg-gold/15 border border-gold/40 text-gold">
                🧪 demo mode — simulated checkout
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {page.products.map((p) => (
          <div key={p.id} className="card">
            <div className="flex justify-between items-start gap-3">
              <div>
                <h2 className="font-display font-bold text-xl">{p.name}</h2>
                <p className="text-white/60 text-sm mt-1">{p.description}</p>
              </div>
              <p className="font-display font-extrabold text-2xl text-mint whitespace-nowrap">
                {p.price} <span className="text-sm">{p.currency}</span>
              </p>
            </div>

            {p.faq.length > 0 && (
              <div className="mt-3 space-y-1">
                {p.faq.map((f, i) => {
                  const key = `${p.id}-${i}`;
                  return (
                    <div key={key} className="bg-ink/50 rounded-lg">
                      <button
                        onClick={() => setOpenFaq(openFaq === key ? null : key)}
                        className="w-full text-left px-3 py-2 text-sm font-medium"
                      >
                        {openFaq === key ? "▾" : "▸"} {f.q}
                      </button>
                      {openFaq === key && (
                        <p className="px-3 pb-3 text-sm text-white/60">{f.a}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={() => startCheckout(p)} className="btn-primary w-full mt-4">
              💳 Pay with PayPal — {p.price} {p.currency}
            </button>
          </div>
        ))}
      </section>

      {/* Checkout modal */}
      {buying && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="card max-w-md w-full">
            <h3 className="font-display font-bold text-lg mb-1">{buying.name}</h3>
            <p className="text-white/60 text-sm mb-4">
              {buying.price} {buying.currency} · secure via PayPal
            </p>

            {!order && (
              <>
                <label className="text-sm text-white/70 block mb-1">Email for receipt</label>
                <input
                  className="input mb-3"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {err && <p className="text-red-300 text-sm mb-2">{err}</p>}
                <div className="flex gap-2">
                  <button onClick={createOrder} disabled={busy} className="btn-primary flex-1">
                    {busy ? "Creating order…" : "Continue to PayPal"}
                  </button>
                  <button onClick={() => setBuying(null)} className="btn-ghost">
                    Cancel
                  </button>
                </div>
                {mode === "mock" && (
                  <p className="text-xs text-white/40 mt-2">
                    🧪 Demo mode: this simulates the PayPal approval screen.
                  </p>
                )}
              </>
            )}

            {order && order.status === "CREATED" && (
              <>
                <div className="bg-ink/60 rounded-xl p-4 mb-3 text-center">
                  <p className="text-sm text-white/60 mb-1">PayPal order</p>
                  <p className="font-mono text-xs break-all">{order.paypalOrderId}</p>
                  <p className="text-2xl font-display font-bold mt-2">
                    {order.amount} {order.currency}
                  </p>
                </div>
                <button onClick={capture} disabled={busy} className="btn-primary w-full">
                  {busy ? "Processing…" : mode === "mock" ? "✅ Simulate PayPal approval & pay" : "Approve & pay"}
                </button>
                <button onClick={() => { setBuying(null); setOrder(null); }} className="btn-ghost w-full mt-2">
                  Close
                </button>
              </>
            )}

            {order && (order.status === "COMPLETED" || order.status === "CAPTURED") && (
              <div className="text-center py-4">
                <p className="text-5xl mb-3">🎉</p>
                <h4 className="font-display font-bold text-lg">Payment successful!</h4>
                <p className="text-white/60 text-sm mt-1">
                  {page.sellerName} has been notified. Receipt sent to {order.buyerEmail}.
                </p>
                <button
                  onClick={() => { setBuying(null); setOrder(null); }}
                  className="btn-primary w-full mt-4"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI support bot */}
      <button
        onClick={() => setBotOpen(!botOpen)}
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-gradient-to-r from-mint to-gold text-ink text-2xl shadow-lg z-40"
        title="Ask the AI support bot"
      >
        💁
      </button>
      {botOpen && (
        <div className="fixed bottom-24 right-5 w-[calc(100vw-2.5rem)] max-w-sm card z-40 flex flex-col max-h-[60vh]">
          <p className="font-display font-bold mb-2">💁 AI Support</p>
          <div className="flex-1 overflow-y-auto space-y-2 mb-3 min-h-32">
            {botLog.length === 0 && (
              <p className="text-white/40 text-sm">
                Ask me anything about {page.sellerName}'s products — prices, delivery, refunds…
              </p>
            )}
            {botLog.map((m, i) => (
              <div
                key={i}
                className={`text-sm rounded-xl px-3 py-2 max-w-[90%] ${
                  m.who === "you"
                    ? "bg-mint/20 ml-auto"
                    : "bg-white/10"
                }`}
              >
                {m.text}
              </div>
            ))}
            {botBusy && <p className="text-white/40 text-sm">typing…</p>}
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Ask a question…"
              value={botQ}
              onChange={(e) => setBotQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askBot()}
            />
            <button onClick={askBot} disabled={botBusy} className="btn-primary px-4">
              ➤
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
