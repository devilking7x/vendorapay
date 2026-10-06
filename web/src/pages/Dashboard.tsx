import { useEffect, useState } from "react";
import {
  api,
  type AbandonedCart,
  type AgentSession,
  type Coupon,
  type DisputeDraft,
  type Invoice,
  type Order,
  type Page,
  type Stats,
  type SubscriptionPlan,
} from "../api";

type Tab = "orders" | "invoices" | "plans" | "agent" | "analytics" | "disputes" | "coupons" | "recovery";

function statusChip(s: string) {
  return <span className={`chip status-${s}`}>{s}</span>;
}

export default function Dashboard({ nav }: { nav: (h: string) => void }) {
  const [pages, setPages] = useState<Array<{ id: string; title: string; sellerName: string }>>([]);
  const [pageId, setPageId] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [mode, setMode] = useState("");
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  // new invoice form
  const [invProduct, setInvProduct] = useState("");
  const [invEmail, setInvEmail] = useState("");
  // new plan form
  const [planName, setPlanName] = useState("");
  const [planPrice, setPlanPrice] = useState("");
  const [planInterval, setPlanInterval] = useState("MONTH");
  // webhook sim
  const [whOrder, setWhOrder] = useState("");
  const [whType, setWhType] = useState("PAYMENT.CAPTURE.COMPLETED");

  const loadPages = async () => {
    try {
      const r = await api.listPages();
      setPages(r.pages);
      const last = localStorage.getItem("vendorapay:lastPage") ?? "";
      const pick = r.pages.find((p) => p.id === last)?.id ?? r.pages[0]?.id ?? "";
      if (pick) setPageId(pick);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const loadAll = async (pid: string) => {
    if (!pid) return;
    try {
      const [pg, o, i, pl, s] = await Promise.all([
        api.getPage(pid),
        api.listOrders(pid),
        api.listInvoices(pid),
        api.listPlans(pid),
        api.listSessions(pid),
      ]);
      setPage(pg.page);
      setMode(pg.paypal);
      setOrders(o.orders);
      setInvoices(i.invoices);
      setPlans(pl.plans);
      setSessions(s.sessions);
      if (pg.page.products[0]) setInvProduct(pg.page.products[0].id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    loadPages();
  }, []);
  useEffect(() => {
    if (pageId) {
      localStorage.setItem("vendorapay:lastPage", pageId);
      loadAll(pageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const refresh = () => loadAll(pageId);

  const makeDemo = async () => {
    setBusy("demo");
    try {
      const { page: p } = await api.demo();
      await loadPages();
      setPageId(p.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const simulate = async () => {
    if (!whOrder) {
      setErr("Pick an order to simulate a webhook for.");
      return;
    }
    setBusy("wh");
    try {
      await api.simulateWebhook(whType, whOrder);
      setWhOrder("");
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const createInvoice = async () => {
    if (!invEmail.includes("@")) {
      setErr("Enter the buyer's email.");
      return;
    }
    setBusy("inv");
    try {
      await api.createInvoice(pageId, invProduct, invEmail);
      setInvEmail("");
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const sendInv = async (id: string) => {
    setBusy(`send-${id}`);
    try {
      await api.sendInvoice(id);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const remindInv = async (id: string) => {
    setBusy(`rem-${id}`);
    try {
      await api.remindInvoice(id);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const createPlan = async () => {
    if (!planName.trim() || !(Number(planPrice) > 0)) {
      setErr("Plan needs a name and a positive price.");
      return;
    }
    setBusy("plan");
    try {
      await api.createPlan(pageId, planName.trim(), Number(planPrice), page?.currency ?? "USD", planInterval);
      setPlanName("");
      setPlanPrice("");
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const setPlan = async (id: string, status: string) => {
    setBusy(`plan-${id}`);
    try {
      await api.setPlanStatus(id, status);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const confirmAgent = async (sid: string) => {
    setBusy(`cf-${sid}`);
    try {
      await api.confirmSession(sid);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const declineAgent = async (sid: string) => {
    setBusy(`dc-${sid}`);
    try {
      await api.declineSession(sid);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="font-display font-extrabold text-3xl">📊 Seller Dashboard</h1>
        <div className="flex gap-2">
          {pages.length > 0 ? (
            <select
              className="input !w-auto"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id} className="bg-ink">
                  {p.title}
                </option>
              ))}
            </select>
          ) : (
            <button onClick={makeDemo} disabled={busy === "demo"} className="btn-primary">
              {busy === "demo" ? "Loading…" : "🚀 Load demo store"}
            </button>
          )}
          {page && (
            <button onClick={() => nav(`#/p/${page.id}`)} className="btn-ghost whitespace-nowrap">
              🌐 View page
            </button>
          )}
        </div>
      </div>

      {err && <p className="text-red-300 text-sm mb-4">{err}</p>}

      {!pageId ? (
        <div className="card text-center py-10">
          <p className="text-white/60 mb-4">
            No storefront yet. Build one with AI or load the demo store.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => nav("#/build")} className="btn-primary">🛠️ Build</button>
            <button onClick={makeDemo} className="btn-ghost">🚀 Demo</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {(["orders", "invoices", "plans", "agent", "analytics", "disputes", "coupons", "recovery"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`tab-btn ${tab === t ? "active" : ""}`}
              >
                {t === "orders" && "💳 Orders"}
                {t === "invoices" && "🧾 Invoices"}
                {t === "plans" && "🔁 Subscriptions"}
                {t === "agent" && "🤖 Agent sales"}
                {t === "analytics" && "📊 Analytics"}
                {t === "disputes" && "⚖️ Disputes"}
                {t === "coupons" && "🎟️ Coupons"}
                {t === "recovery" && "🛒 Recovery"}
              </button>
            ))}
          </div>

          {tab === "orders" && (
            <div>
              {mode === "mock" && (
                <div className="card mb-4">
                  <p className="text-sm font-medium mb-2">🧪 Simulate a PayPal webhook (demo mode)</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select className="input" value={whOrder} onChange={(e) => setWhOrder(e.target.value)}>
                      <option value="" className="bg-ink">Pick an order…</option>
                      {orders.map((o) => (
                        <option key={o.id} value={o.id} className="bg-ink">
                          {o.productName} — {o.amount} {o.currency} ({o.status})
                        </option>
                      ))}
                    </select>
                    <select className="input" value={whType} onChange={(e) => setWhType(e.target.value)}>
                      <option className="bg-ink" value="PAYMENT.CAPTURE.COMPLETED">PAYMENT.CAPTURE.COMPLETED</option>
                      <option className="bg-ink" value="CHECKOUT.ORDER.APPROVED">CHECKOUT.ORDER.APPROVED</option>
                      <option className="bg-ink" value="PAYMENT.CAPTURE.DENIED">PAYMENT.CAPTURE.DENIED</option>
                    </select>
                    <button onClick={simulate} disabled={busy === "wh"} className="btn-primary whitespace-nowrap">
                      Fire event
                    </button>
                  </div>
                </div>
              )}
              <div className="card">
                {orders.length === 0 ? (
                  <p className="text-white/50 text-sm">No orders yet — share your storefront link to get paid.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-white/40 border-b border-white/10">
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3">Buyer</th>
                          <th className="py-2 pr-3">Amount</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2">PayPal ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id} className="border-b border-white/5">
                            <td className="py-2 pr-3">{o.productName}</td>
                            <td className="py-2 pr-3 text-white/60">{o.buyerEmail}</td>
                            <td className="py-2 pr-3 font-medium">{o.amount} {o.currency}</td>
                            <td className="py-2 pr-3">{statusChip(o.status)}</td>
                            <td className="py-2 font-mono text-xs text-white/40">{o.paypalOrderId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "invoices" && (
            <div className="space-y-4">
              <div className="card">
                <p className="font-medium mb-3">🧾 New AI-drafted invoice</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select className="input" value={invProduct} onChange={(e) => setInvProduct(e.target.value)}>
                    {(page?.products ?? []).map((p) => (
                      <option key={p.id} value={p.id} className="bg-ink">
                        {p.name} — {p.price} {p.currency}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="buyer@email.com"
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                  />
                  <button onClick={createInvoice} disabled={busy === "inv"} className="btn-primary whitespace-nowrap">
                    {busy === "inv" ? "Drafting…" : "Draft invoice"}
                  </button>
                </div>
              </div>
              <div className="card">
                {invoices.length === 0 ? (
                  <p className="text-white/50 text-sm">No invoices yet.</p>
                ) : (
                  <div className="space-y-3">
                    {invoices.map((inv) => (
                      <div key={inv.id} className="bg-ink/50 rounded-xl p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div>
                            <p className="font-medium">{inv.productName}</p>
                            <p className="text-xs text-white/50">
                              {inv.buyerEmail} · due {inv.dueDate}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-bold text-mint">
                              {inv.amount} {inv.currency}
                            </span>
                            {statusChip(inv.status)}
                          </div>
                        </div>
                        <p className="text-xs text-white/40 mb-2">📝 {inv.notes}</p>
                        {inv.reminderSent && inv.reminderText && (
                          <p className="text-xs bg-gold/10 border border-gold/30 rounded-lg p-2 mb-2">
                            ⏰ Reminder sent: “{inv.reminderText.slice(0, 160)}…”
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {inv.status === "DRAFT" && (
                            <button onClick={() => sendInv(inv.id)} disabled={busy === `send-${inv.id}`} className="btn-primary !px-4 !py-2 text-sm">
                              📨 Send
                            </button>
                          )}
                          {(inv.status === "SENT" || inv.status === "OVERDUE") && !inv.reminderSent && (
                            <button onClick={() => remindInv(inv.id)} disabled={busy === `rem-${inv.id}`} className="btn-ghost !px-4 !py-2 text-sm">
                              ⏰ AI reminder
                            </button>
                          )}
                          {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                            <button onClick={() => api.markPaid(inv.id).then(refresh)} className="btn-ghost !px-4 !py-2 text-sm">
                              ✅ Mark paid
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "plans" && (
            <div className="space-y-4">
              <div className="card">
                <p className="font-medium mb-3">🔁 New subscription plan</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input className="input" placeholder="Plan name" value={planName} onChange={(e) => setPlanName(e.target.value)} />
                  <input className="input" placeholder="Price" type="number" min="1" value={planPrice} onChange={(e) => setPlanPrice(e.target.value)} />
                  <select className="input" value={planInterval} onChange={(e) => setPlanInterval(e.target.value)}>
                    <option className="bg-ink" value="MONTH">Monthly</option>
                    <option className="bg-ink" value="YEAR">Yearly</option>
                  </select>
                  <button onClick={createPlan} disabled={busy === "plan"} className="btn-primary whitespace-nowrap">
                    Create plan
                  </button>
                </div>
              </div>
              <div className="card">
                {plans.length === 0 ? (
                  <p className="text-white/50 text-sm">No subscription plans yet.</p>
                ) : (
                  <div className="space-y-2">
                    {plans.map((p) => (
                      <div key={p.id} className="bg-ink/50 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-white/50">
                            {p.price} {p.currency} / {p.interval === "MONTH" ? "month" : "year"} · {p.paypalPlanId}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusChip(p.status)}
                          {p.status === "ACTIVE" && (
                            <button onClick={() => setPlan(p.id, "PAUSED")} className="btn-ghost !px-3 !py-1 text-xs">Pause</button>
                          )}
                          {p.status === "PAUSED" && (
                            <button onClick={() => setPlan(p.id, "ACTIVE")} className="btn-ghost !px-3 !py-1 text-xs">Resume</button>
                          )}
                          {p.status !== "CANCELLED" && (
                            <button onClick={() => setPlan(p.id, "CANCELLED")} className="btn-ghost !px-3 !py-1 text-xs">Cancel</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "agent" && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display font-bold">🤖 Agentic Salesperson</p>
                    <p className="text-sm text-white/60">
                      Negotiates inside your price bounds, shows its reasoning, and only charges after you confirm.
                    </p>
                  </div>
                  <button onClick={() => nav(`#/agent/${pageId}`)} className="btn-primary">
                    Open agent console
                  </button>
                </div>
              </div>
              {sessions.length === 0 ? (
                <div className="card">
                  <p className="text-white/50 text-sm">No agent sales yet — start one from the agent console.</p>
                </div>
              ) : (
                sessions.map((s) => (
                  <div key={s.id} className="card">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div>
                        <p className="font-medium">
                          {s.buyerName} → {s.productName}
                        </p>
                        <p className="text-xs text-white/50">
                          bounds [{s.minPrice}, {s.maxPrice}] {s.currency} · {s.messages.length} messages
                        </p>
                      </div>
                      {statusChip(s.state.toUpperCase())}
                    </div>
                    {s.pendingCharge && s.state === "awaiting_seller_confirm" && (
                      <div className="bg-gold/10 border border-gold/30 rounded-xl p-3 mb-2">
                        <p className="text-sm mb-2">
                          💰 Agreed: <strong>{s.pendingCharge.amount} {s.pendingCharge.currency}</strong> — confirm to create the PayPal charge, or decline.
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => confirmAgent(s.id)} disabled={busy === `cf-${s.id}`} className="btn-primary !px-4 !py-2 text-sm">
                            ✅ Confirm charge
                          </button>
                          <button onClick={() => declineAgent(s.id)} disabled={busy === `dc-${s.id}`} className="btn-ghost !px-4 !py-2 text-sm">
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                    <details className="text-sm">
                      <summary className="cursor-pointer text-mint">🧠 See agent reasoning ({s.steps.length} steps)</summary>
                      <div className="mt-2 space-y-1">
                        {s.steps.map((st) => (
                          <p key={st.step} className="text-xs text-white/60 bg-ink/50 rounded-lg p-2">
                            <strong className="text-white/80">Step {st.step}:</strong> {st.reasoning}{" "}
                            <em>→ {st.action}</em>
                          </p>
                        ))}
                      </div>
                    </details>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "analytics" && (
            <AnalyticsView />
          )}

          {tab === "disputes" && (
            <DisputesView orders={orders} />
          )}

          {tab === "coupons" && (
            <CouponsView pageId={pageId} />
          )}
          {tab === "recovery" && (
            <RecoveryView pageId={pageId} />
          )}
        </>
      )}
    </div>
  );
}

function AnalyticsView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api
      .getStats()
      .then((r) => setStats(r.stats))
      .catch((e) => setErr((e as Error).message));
  }, []);
  if (err) return <div className="card"><p className="text-red-400 text-sm">{err}</p></div>;
  if (!stats) return <div className="card"><p className="text-white/50 text-sm">Loading analytics…</p></div>;
  const cards = [
    { label: "💰 Revenue", value: `${stats.totalRevenue} ${stats.currency}` },
    { label: "👁️ Page views", value: String(stats.totalViews) },
    { label: "🛒 Orders", value: `${stats.paidOrders}/${stats.totalOrders} paid` },
    { label: "📈 Conversion", value: `${stats.conversion}%` },
    { label: "🧾 Invoices paid", value: `${stats.invoicesPaid}/${stats.invoicesSent}` },
    { label: "🤖 Active agent chats", value: String(stats.activeSessions) },
    { label: "📈 Upsells suggested", value: String(stats.upsellsSuggested ?? 0) },
    { label: "✅ Upsells accepted", value: String(stats.upsellsAccepted ?? 0) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card !p-4">
            <p className="text-xs text-white/50 mb-1">{c.label}</p>
            <p className="font-display font-extrabold text-xl text-gold">{c.value}</p>
          </div>
        ))}
      </div>
      {stats.topProducts.length > 0 && (
        <div className="card">
          <p className="font-display font-bold mb-3">🏆 Top products by revenue</p>
          <div className="space-y-2">
            {stats.topProducts.map((t, i) => (
              <div key={t.name} className="flex items-center justify-between gap-2">
                <p className="text-sm truncate">
                  <span className="text-gold font-bold mr-2">#{i + 1}</span>
                  {t.name}
                </p>
                <p className="text-sm text-white/60 shrink-0">
                  {t.revenue} {stats.currency} · {t.orders} sold
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {stats.pages.length > 0 && (
        <div className="card">
          <p className="font-display font-bold mb-3">📄 Per-page performance</p>
          <div className="space-y-2">
            {stats.pages.map((p) => (
              <div key={p.pageId} className="flex items-center justify-between gap-2 text-sm">
                <p className="truncate text-white/80">{p.title}</p>
                <p className="text-white/50 shrink-0 text-xs">
                  {p.views} views · {p.orders} orders · {p.conversion}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {stats.totalViews === 0 && stats.totalOrders === 0 && (
        <div className="card">
          <p className="text-white/50 text-sm">
            No traffic yet — share your page link to start collecting stats! 📣
          </p>
        </div>
      )}
    </div>
  );
}

function DisputesView({ orders }: { orders: Order[] }) {
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<DisputeDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!reason.trim()) {
      setErr("Describe the buyer's dispute reason first.");
      return;
    }
    setLoading(true);
    setErr("");
    setDraft(null);
    try {
      const r = await api.draftDispute(orderId, reason, notes);
      setDraft(r.draft);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.message}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <p className="font-display font-bold">⚖️ AI Dispute Helper</p>
          <p className="text-sm text-white/60">
            Got a PayPal dispute? Pick the order, describe the issue — AI drafts a calm,
            professional response you can send.
          </p>
        </div>
        {orders.length > 0 && (
          <div>
            <label className="text-sm text-white/70 block mb-1">Related order (optional)</label>
            <select className="input w-full" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">— No specific order —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.productName} — {o.amount} {o.currency} ({o.status})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-sm text-white/70 block mb-1">Buyer's dispute reason *</label>
          <textarea
            className="input w-full min-h-20"
            placeholder='e.g. "Buyer says the logo files were never delivered"'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-white/70 block mb-1">Your notes (optional)</label>
          <textarea
            className="input w-full min-h-16"
            placeholder="e.g. Files were emailed on Oct 2, buyer confirmed receipt"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <button onClick={generate} disabled={loading} className="btn-primary">
          {loading ? "✍️ Drafting…" : "✍️ Draft my response"}
        </button>
      </div>
      {draft && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/50">
              Drafted by {draft.engine === "template" ? "smart template" : draft.engine} · review before sending
            </p>
            <button onClick={copy} className="btn-ghost !px-3 !py-1 text-sm">
              {copied ? "✅ Copied!" : "📋 Copy"}
            </button>
          </div>
          <p className="font-bold">{draft.subject}</p>
          <p className="text-sm text-white/80 whitespace-pre-wrap">{draft.message}</p>
        </div>
      )}
    </div>
  );
}

function CouponsView({ pageId }: { pageId: string }) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [pct, setPct] = useState("20");
  const [uses, setUses] = useState("100");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!pageId) return;
    try {
      const r = await api.listCoupons(pageId);
      setCoupons(r.coupons);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, [pageId]);

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.createCoupon(pageId, code, Number(pct), Number(uses));
      setCode("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <p className="font-display font-bold">🎟️ Discount Coupons</p>
          <p className="text-sm text-white/60">
            Create coupon codes buyers can apply at checkout — e.g. SAVE20 for 20% off.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-sm text-white/70 block mb-1">Code</label>
            <input
              className="input w-full uppercase"
              placeholder="SAVE20"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className="text-sm text-white/70 block mb-1">% off</label>
            <input
              className="input w-full"
              type="number"
              min={1}
              max={90}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-white/70 block mb-1">Max uses</label>
            <input
              className="input w-full"
              type="number"
              min={1}
              value={uses}
              onChange={(e) => setUses(e.target.value)}
            />
          </div>
        </div>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <button onClick={create} disabled={busy || !code.trim()} className="btn-primary">
          {busy ? "Creating…" : "➕ Create coupon"}
        </button>
      </div>
      <div className="card">
        <p className="font-display font-bold mb-3">Active coupons</p>
        {coupons.length === 0 ? (
          <p className="text-white/50 text-sm">No coupons yet — create your first one above!</p>
        ) : (
          <div className="space-y-2">
            {coupons.map((c) => (
              <div key={c.code} className="flex items-center justify-between gap-2 text-sm">
                <p className="font-mono font-bold text-gold">{c.code}</p>
                <p className="text-white/60 text-xs">
                  {c.percentOff}% off · {c.usedCount}/{c.maxUses} used
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecoveryView({ pageId }: { pageId: string }) {
  const [carts, setCarts] = useState<AbandonedCart[]>([]);
  const [stats, setStats] = useState<{ abandoned: number; nudged: number; recovered: number; recoveryRate: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [sweetenerOn, setSweetenerOn] = useState(false);
  const [sweetenerPct, setSweetenerPct] = useState("10");
  const [nudgeResult, setNudgeResult] = useState("");

  const load = async () => {
    if (!pageId) return;
    try {
      const r = await api.listAbandoned(pageId);
      setCarts(r.carts);
      setStats(r.stats);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, [pageId]);

  const nudge = async (orderId: string) => {
    setErr("");
    setNudgeResult("");
    setBusy(orderId);
    try {
      const r = await api.nudgeCart(pageId, orderId);
      setNudgeResult(`📨 Nudge ready (demo — logged, not sent): "${r.nudge.message.slice(0, 120)}..."`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const saveSettings = async () => {
    setErr("");
    try {
      await api.setRecoverySettings(pageId, sweetenerOn, Number(sweetenerPct));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="font-display font-bold mb-1">🛒 Abandoned Cart Recovery</p>
        <p className="text-sm text-white/60 mb-3">
          Orders created but not paid within 30 minutes. Send a one-time friendly nudge —
          <strong> message only, never a charge</strong>.
        </p>
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="card !p-3"><p className="text-xs text-white/50">Abandoned</p><p className="font-bold text-gold text-lg">{stats.abandoned}</p></div>
            <div className="card !p-3"><p className="text-xs text-white/50">Nudged</p><p className="font-bold text-lg">{stats.nudged}</p></div>
            <div className="card !p-3"><p className="text-xs text-white/50">Recovered</p><p className="font-bold text-mint text-lg">{stats.recovered}</p></div>
            <div className="card !p-3"><p className="text-xs text-white/50">Recovery rate</p><p className="font-bold text-lg">{stats.recoveryRate}%</p></div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sweetenerOn} onChange={(e) => setSweetenerOn(e.target.checked)} />
            Enable comeback discount
          </label>
          {sweetenerOn && (
            <input
              className="input w-20"
              type="number"
              min={1}
              max={30}
              value={sweetenerPct}
              onChange={(e) => setSweetenerPct(e.target.value)}
            />
          )}
          {sweetenerOn && <span className="text-sm text-white/60">% off (single-use coupon, auto-created)</span>}
          <button onClick={saveSettings} className="btn-ghost text-sm">Save settings</button>
        </div>
      </div>

      {err && <div className="card"><p className="text-red-400 text-sm">{err}</p></div>}
      {nudgeResult && <div className="card"><p className="text-sm text-mint">{nudgeResult}</p></div>}

      <div className="card">
        <p className="font-display font-bold mb-3">Abandoned carts</p>
        {carts.length === 0 ? (
          <p className="text-sm text-white/50">No abandoned carts — every checkout completed! 🎉</p>
        ) : (
          <div className="space-y-2">
            {carts.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-white/5">
                <div>
                  <p className="text-sm font-medium">{c.productName} — {c.amount} {c.currency}</p>
                  <p className="text-xs text-white/50">
                    {c.buyerEmail} · abandoned {new Date(c.abandonedAt).toLocaleString()}
                    {c.recovered && <span className="text-mint ml-2">✅ recovered</span>}
                    {c.nudged && !c.recovered && <span className="text-gold ml-2">📨 nudged</span>}
                  </p>
                </div>
                {!c.nudged && !c.recovered && (
                  <button
                    onClick={() => nudge(c.orderId)}
                    disabled={busy === c.orderId}
                    className="btn-primary text-sm whitespace-nowrap"
                  >
                    {busy === c.orderId ? "…" : "📨 Send nudge"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
