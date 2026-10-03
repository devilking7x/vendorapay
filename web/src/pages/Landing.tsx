import { useState } from "react";
import { api } from "../api";

const FEATURES: Array<{ emoji: string; title: string; desc: string }> = [
  { emoji: "💬", title: "AI Page Builder", desc: "Describe what you sell in chat — AI builds your payment page: title, pricing, FAQ, theme." },
  { emoji: "💳", title: "PayPal Checkout", desc: "Real PayPal Orders API — create & capture payments from buyers anywhere." },
  { emoji: "🧾", title: "Smart Invoices", desc: "AI drafts line items and polite notes; send to any email in one click." },
  { emoji: "🔁", title: "Subscriptions", desc: "Monthly/yearly retainer plans for recurring revenue." },
  { emoji: "🤖", title: "Agentic Salesperson", desc: "An AI agent that negotiates within YOUR price bounds and only charges after you confirm." },
  { emoji: "💡", title: "Pricing Coach", desc: "AI suggests a fair price range for your category and market." },
  { emoji: "💁", title: "AI Support Bot", desc: "Every storefront gets a chat widget that answers buyer questions from your product data." },
  { emoji: "⏰", title: "AI Reminders", desc: "Overdue invoice? AI drafts the polite nudge and marks it sent." },
  { emoji: "📦", title: "Multi-product", desc: "One storefront, many products — each with its own price and FAQ." },
  { emoji: "🎙️", title: "Voice-to-storefront", desc: "Tap the mic, describe your business out loud, watch the page build itself." },
];

export default function Landing({ nav }: { nav: (h: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const tryDemo = async () => {
    setLoading(true);
    setErr("");
    try {
      const { page } = await api.demo();
      localStorage.setItem("vendorapay:lastPage", page.id);
      nav(`#/p/${page.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-14 pb-10 text-center">
        <p className="chip mb-5">PayPal AI Hackathon 2026</p>
        <h1 className="font-display font-extrabold text-4xl sm:text-6xl leading-tight tracking-tight">
          Sell anything, anywhere —{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint to-gold">
            just describe it.
          </span>
        </h1>
        <p className="text-white/70 text-lg mt-5 max-w-2xl mx-auto">
          Vendora Pay AI turns a chat message into a working PayPal storefront: AI-built
          payment pages, smart invoices, subscriptions, and an{" "}
          <strong className="text-white">agentic salesperson</strong> that negotiates for
          you — with guardrails.
        </p>
        <p className="text-mint/90 text-sm mt-4 max-w-2xl mx-auto">
          🌍 Built for sellers in countries Stripe doesn't reach — PayPal does.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <button onClick={() => nav("#/build")} className="btn-primary">
            🛠️ Build my storefront
          </button>
          <button onClick={tryDemo} disabled={loading} className="btn-ghost">
            {loading ? "Opening demo…" : "🚀 Try the live demo"}
          </button>
        </div>
        {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
        <p className="text-white/30 text-xs mt-4">
          Demo runs on simulated PayPal (🧪 demo mode) — no real money moves until you add sandbox keys.
        </p>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="font-display font-bold text-2xl mb-5 text-center">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { n: "1", t: "Describe", d: "Type or speak what you sell — \"I sell logo design for $50\". AI drafts the page, pricing and FAQ." },
            { n: "2", t: "Share & sell", d: "Send buyers your link. They pay via PayPal, ask the AI support bot, or haggle with your agentic salesperson." },
            { n: "3", t: "Manage", d: "Dashboard tracks orders, invoices, subscriptions and webhook events live. AI nudges late payers for you." },
          ].map((s) => (
            <div key={s.n} className="card">
              <div className="w-9 h-9 rounded-full bg-mint/20 text-mint font-display font-bold flex items-center justify-center mb-3">
                {s.n}
              </div>
              <h3 className="font-display font-bold mb-1">{s.t}</h3>
              <p className="text-white/60 text-sm">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="font-display font-bold text-2xl mb-5 text-center">
          Everything a seller needs
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <div className="text-2xl mb-2">{f.emoji}</div>
              <h3 className="font-display font-bold mb-1">{f.title}</h3>
              <p className="text-white/60 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Guardrails */}
      <section className="max-w-5xl mx-auto px-4 py-8">
        <div className="card border-mint/30">
          <h2 className="font-display font-bold text-xl mb-2">🛡️ Guardrailed autonomy</h2>
          <p className="text-white/60 text-sm">
            The agentic salesperson negotiates <strong className="text-white">only</strong> inside
            the min/max price you set, shows its reasoning step-by-step, and{" "}
            <strong className="text-white">never creates a charge without your explicit
            confirmation</strong>. You stay in control; the AI does the hustle.
          </p>
        </div>
      </section>
    </div>
  );
}
