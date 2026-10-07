import { useEffect, useRef, useState } from "react";
import { api, type Page, type PriceSuggestion } from "../api";

type SpeechRecognitionType = {
  new (): {
    lang: string;
    interimResults: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
  };
};

function getSpeechRecognition(): SpeechRecognitionType | null {
  const w = window as unknown as Record<string, unknown>;
  const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecognitionType | undefined;
  return SR ?? null;
}

const EXAMPLES = [
  "I sell logo design for $50, 3 revisions included",
  "I offer business coaching at $99 per session",
  "I sell handmade soy candles for $18 each",
];

export default function Builder({ nav }: { nav: (h: string) => void }) {
  const [desc, setDesc] = useState(
    () => sessionStorage.getItem("vendorapay:buildDesc") ?? ""
  );
  const [seller, setSeller] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [building, setBuilding] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [engine, setEngine] = useState("");
  const [err, setErr] = useState("");
  const [listening, setListening] = useState(false);
  const [speechNote, setSpeechNote] = useState("");
  const [coach, setCoach] = useState<PriceSuggestion | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const toggleMic = () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setSpeechNote(
        "🎙️ Voice input isn't supported in this browser — Chrome or Edge on desktop works best. You can type instead!"
      );
      return;
    }
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      setListening(false);
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const text = e.results[0]?.[0]?.transcript ?? "";
        if (text) setDesc((d) => (d ? d + " " : "") + text);
      };
      rec.onerror = () => {
        setListening(false);
        setSpeechNote("Mic error — please check microphone permission and try again.");
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
      setSpeechNote("🎙️ Listening… describe what you sell!");
    } catch {
      setSpeechNote("Could not start voice input in this browser — typing works fine.");
    }
  };

  const build = async () => {
    if (!desc.trim()) {
      setErr("Describe what you sell first — a line or two is enough.");
      return;
    }
    setBuilding(true);
    setErr("");
    setPage(null);
    try {
      const r = await api.buildPage(desc, seller || "Your Studio", currency);
      setPage(r.page);
      setEngine(r.engine);
      const ids = JSON.parse(localStorage.getItem("vendorapay:pages") ?? "[]") as string[];
      if (!ids.includes(r.page.id)) {
        ids.push(r.page.id);
        localStorage.setItem("vendorapay:pages", JSON.stringify(ids));
      }
      localStorage.setItem("vendorapay:lastPage", r.page.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const askCoach = async () => {
    if (!desc.trim()) {
      setErr("Describe your offering first so the coach has something to price.");
      return;
    }
    setCoachLoading(true);
    try {
      const s = await api.suggestPrice("", desc, currency);
      setCoach(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCoachLoading(false);
    }
  };

  const onPhotoPicked = async (file: File | undefined) => {
    setPhotoNote("");
    setErr("");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setPhotoNote("⚠️ Photo is over 5MB — pick a smaller one.");
      return;
    }
    setPhotoLoading(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("could not read photo"));
        r.readAsDataURL(file);
      });
      const r = await api.photoListing(b64, file.type || "image/jpeg");
      if (r.listing.ai) {
        // Pre-fill the builder form from the AI-drafted listing.
        const parts = [
          r.listing.title,
          r.listing.description,
          r.listing.suggestedPrice > 0 ? `Suggested price: $${r.listing.suggestedPrice}.` : "",
        ].filter(Boolean);
        setDesc(parts.join(" "));
        setPhotoNote(`📸 AI drafted a listing from your photo [${r.listing.engine}] — review & edit, then build!`);
      } else {
        setPhotoNote(`⚠️ ${r.listing.engine}`);
      }
    } catch (e) {
      setPhotoNote(`⚠️ Photo listing failed: ${(e as Error).message}`);
    } finally {
      setPhotoLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-display font-extrabold text-3xl mb-2">🛠️ AI Page Builder</h1>
      <p className="text-white/60 mb-6">
        Describe what you sell — type it or tap the mic and say it. AI builds your payment page.
      </p>

      <div className="card space-y-4">
        <div>
          <label className="text-sm text-white/70 block mb-1">What do you sell?</label>
          <div className="flex gap-2">
            <textarea
              className="input min-h-24 flex-1"
              placeholder='e.g. "I sell logo design for $50, 3 revisions included"'
              value={desc}
              onChange={(e) => {
                setDesc(e.target.value);
                sessionStorage.setItem("vendorapay:buildDesc", e.target.value);
              }}
            />
            <button
              onClick={toggleMic}
              title="Voice input"
              className={`shrink-0 w-14 rounded-xl border text-2xl transition ${
                listening
                  ? "bg-red-500/20 border-red-400 animate-pulse"
                  : "border-white/20 hover:border-mint"
              }`}
            >
              {listening ? "⏹️" : "🎙️"}
            </button>
          </div>
          {speechNote && <p className="text-xs text-gold mt-1">{speechNote}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setDesc(ex)} className="chip hover:bg-white/20 text-left">
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-white/70 block mb-1">Your name / brand</label>
            <input
              className="input"
              placeholder="Your Studio"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-white/70 block mb-1">Currency</label>
            <select
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["USD", "EUR", "GBP", "INR", "AED", "SGD", "NGN", "BRL"].map((c) => (
                <option key={c} value={c} className="bg-ink">
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {err && <p className="text-red-300 text-sm">{err}</p>}

        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={build} disabled={building} className="btn-primary flex-1">
            {building ? "Building your page…" : "✨ Build my payment page"}
          </button>
          <button onClick={askCoach} disabled={coachLoading} className="btn-ghost">
            {coachLoading ? "Thinking…" : "💡 Pricing coach"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={photoLoading} className="btn-ghost">
            {photoLoading ? "Reading photo…" : "📸 Photo → Listing"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => onPhotoPicked(e.target.files?.[0])}
          />
        </div>
        {photoNote && <p className="text-sm text-white/70">{photoNote}</p>}

        {coach && (
          <div className="bg-ink/50 border border-gold/30 rounded-xl p-4">
            <p className="text-sm">
              💡 Suggested range:{" "}
              <strong className="text-gold">
                {coach.min}–{coach.max} {currency}
              </strong>{" "}
              · sweet spot <strong className="text-mint">{coach.recommended} {currency}</strong>
            </p>
            <p className="text-xs text-white/50 mt-1">{coach.rationale}</p>
            <p className="text-xs text-white/30 mt-1">
              {coach.engine === "nebius" ? "✨ suggested by Nebius AI" : "📝 smart-template heuristic"}
            </p>
          </div>
        )}
      </div>

      {page && (
        <div className="card mt-6 border-mint/40">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h2 className="font-display font-bold text-xl">{page.title}</h2>
              <p className="text-white/60 text-sm">{page.tagline}</p>
            </div>
            <span
              className="w-10 h-10 rounded-xl shrink-0"
              style={{ background: page.themeColor }}
            />
          </div>
          <p className="text-xs text-white/40 mb-3">
            {engine === "nebius"
              ? "✨ Page copy generated by Nebius AI"
              : "📝 Page copy by smart template (add NEBIUS_API_KEY for genuine AI copy)"}
          </p>
          <div className="space-y-2 mb-4">
            {page.products.map((p) => (
              <div key={p.id} className="bg-ink/50 rounded-xl p-3 flex justify-between items-center">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-white/50 line-clamp-1">{p.description}</p>
                </div>
                <p className="font-display font-bold text-mint whitespace-nowrap ml-2">
                  {p.price} {p.currency}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={() => nav(`#/p/${page.id}`)} className="btn-primary flex-1">
              🌐 View my storefront
            </button>
            <button onClick={() => nav("#/dashboard")} className="btn-ghost">
              📊 Open dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
