import { useEffect, useState } from "react";
import { api } from "./api";
import Landing from "./pages/Landing";
import Builder from "./pages/Builder";
import Storefront from "./pages/Storefront";
import Dashboard from "./pages/Dashboard";
import AgentPage from "./pages/AgentPage";

function route() {
  const h = window.location.hash || "#/";
  let m = h.match(/^#\/p\/([^/]+)$/);
  if (m) return { page: "storefront", id: m[1] };
  m = h.match(/^#\/agent(?:\/([^/]+))?$/);
  if (m) return { page: "agent", id: m[1] };
  if (h.startsWith("#/dashboard")) return { page: "dashboard" };
  if (h === "#/build") return { page: "build" };
  return { page: "home" };
}

export default function App() {
  const [r, setR] = useState(route());
  const [mode, setMode] = useState<string>("");
  const [ai, setAi] = useState<string>("");

  useEffect(() => {
    const onHash = () => setR(route());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setMode(h.paypal);
        setAi(h.ai);
      })
      .catch(() => {});
  }, []);

  const nav = (h: string) => {
    window.location.hash = h;
  };

  const id = (r as { id?: string }).id;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 sticky top-0 bg-ink/90 backdrop-blur z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <button
            onClick={() => nav("#/")}
            className="font-display font-extrabold text-lg sm:text-xl tracking-tight"
          >
            💸 Vendora{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-mint to-gold">
              Pay AI
            </span>
          </button>
          <nav className="flex items-center gap-1 sm:gap-2 text-sm">
            <button onClick={() => nav("#/build")} className="px-3 py-2 hover:text-mint">
              Build
            </button>
            <button onClick={() => nav("#/dashboard")} className="px-3 py-2 hover:text-mint">
              Dashboard
            </button>
            {mode === "mock" && (
              <span className="chip bg-gold/15 border border-gold/40 text-gold" title="Simulated PayPal — no real money moves">
                🧪 demo mode
              </span>
            )}
            {mode === "live" && <span className="chip bg-mint/15 text-mint">🟢 live PayPal</span>}
            {ai === "nebius" && <span className="chip hidden sm:inline-flex">✨ Nebius AI</span>}
          </nav>
        </div>
      </header>
      <main>
        {r.page === "home" && <Landing nav={nav} />}
        {r.page === "build" && <Builder nav={nav} />}
        {r.page === "storefront" && <Storefront id={id ?? ""} nav={nav} />}
        {r.page === "dashboard" && <Dashboard nav={nav} />}
        {r.page === "agent" && <AgentPage nav={nav} initialPageId={id} />}
      </main>
      <footer className="border-t border-white/10 mt-10">
        <p className="text-center text-white/30 text-xs py-6 px-4">
          Vendora Pay AI · PayPal sandbox + AI storefronts · built for the PayPal AI Hackathon 2026
        </p>
      </footer>
    </div>
  );
}
