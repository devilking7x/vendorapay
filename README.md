# 💸 Vendora Pay AI

**Sell anything, anywhere — just describe it.** Vendora Pay AI turns a chat message into a working PayPal storefront: AI-built payment pages, smart invoices, subscriptions, and an **agentic salesperson** that negotiates for you — with guardrails.

Built for the **PayPal AI Hackathon 2026** ($69,750 prizes).

## The problem

Millions of freelancers and creators sell through DMs and spreadsheets because setting up real online payments feels like a developer project. And in many countries, Stripe doesn't even operate — but **PayPal does**. Vendora gives any seller a global, AI-powered storefront in under a minute: describe what you sell, get a payment page, get paid.

## How it works

1. **Describe** — type or speak what you sell ("I sell logo design for $50"). AI builds your payment page: title, pricing, FAQ, theme.
2. **Share & sell** — buyers pay via PayPal, ask the AI support bot questions, or haggle with your agentic salesperson (which negotiates only inside YOUR price bounds and never charges without your confirmation).
3. **Manage** — the dashboard tracks orders, invoices, subscriptions and webhook events live; AI drafts polite nudges for overdue invoices.

## Why PayPal is the core (not a bolt-on)

Remove PayPal and Vendora is a pretty page generator. With it, it's a business: real Orders (create → capture), Invoices (draft → send), Subscriptions (plans), and Webhooks drive every money movement. The agentic salesperson exists to move PayPal transactions — it has no purpose without the PayPal platform.

## Tech

- **Frontend:** Vite + React + TypeScript + Tailwind (dark commerce theme)
- **Backend:** Express + TypeScript
- **Payments:** PayPal REST (sandbox) — Orders v2, Invoicing v2, Subscriptions (catalogs + billing plans), Webhooks
- **AI:** NVIDIA Nemotron via Nebius (OpenAI-compatible) when `NEBIUS_API_KEY` is set; honest smart-template fallback otherwise — the UI always labels which engine produced the output
- **Deploy:** Render (free tier, single service serving API + static web)

## Run locally

```bash
# backend (terminal 1)
cd server && npm install && npm run dev
# frontend (terminal 2)
cd web && npm install && npm run dev
```

Full demo without any keys (everything simulated, clearly labeled):

```bash
PAYPAL_MOCK=1   # default — simulated PayPal end-to-end, "demo mode" badge in UI
```

Mock-mode E2E (27 assertions — needs the server built first):

```bash
npm run build --prefix server && node server/test/e2e.mjs
```

## Mock vs live

| | `PAYPAL_MOCK=1` (default) | Live sandbox |
|---|---|---|
| Orders | Simulated create → capture, in-app | Real PayPal sandbox REST |
| Invoices | Drafted + "sent" (logged in UI) | Real Invoicing API v2 |
| Subscriptions | Full CRUD in-app | Real catalogs + billing plans |
| Webhooks | "Fire event" simulator button | Real `POST /api/webhooks/paypal` |
| Money | None moves — ever | Sandbox test accounts only |
| UI badge | 🧪 demo mode | 🟢 live PayPal |

To go live: create a free REST API app at [developer.paypal.com](https://developer.paypal.com), put `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` in the Render dashboard (never in the repo or chat), and set `PAYPAL_MOCK=0`.

## Env vars

| Var | Required | Notes |
|---|---|---|
| `PAYPAL_MOCK` | no | `1` = simulated PayPal (default). `0` + keys = real sandbox |
| `PAYPAL_CLIENT_ID` | for live | Free at developer.paypal.com. **Never commit it.** |
| `PAYPAL_CLIENT_SECRET` | for live | Same. **Never commit it.** |
| `NEBIUS_API_KEY` | no | Genuine AI copy via NVIDIA Nemotron; without it the labeled template engine is used |
| `PORT` | no | Defaults to `3000` |

## API overview

- `GET /api/health` — `{ ok, paypal: mock|live|none, ai: nebius|template }`
- `POST /api/pages` — AI page builder `{ description, sellerName, currency }`
- `GET /api/pages/:id` — public storefront data
- `POST /api/orders` → `POST /api/orders/:id/capture` — PayPal checkout
- `POST /api/invoices` → `/send`, `/remind`, `/mark-paid` — smart invoicing
- `POST /api/subscriptions/plans` → `PATCH /api/subscriptions/:id` — retainers
- `POST /api/webhooks/paypal` — live webhook receiver; `POST /api/webhooks/simulate` — mock event simulator
- `POST /api/agent/sell` — start/continue an agentic sale; `POST /api/agent/:sid/confirm` (creates the charge — seller only), `/decline`
- `POST /api/support/ask` — buyer Q&A bot; `POST /api/pricing/suggest` — pricing coach
- `POST /api/demo` — one-click demo storefront

## Guardrails (agentic salesperson)

- Negotiates **only** inside the seller's `[minPrice, maxPrice]` — below-floor offers get a counter, above-ceiling offers are capped at the ceiling.
- **Never creates a charge** on its own — `confirmSession` (explicit seller click) is the single code path that calls PayPal.
- Every decision is logged as a reasoning step, visible in the UI.

## Features (20)

1. **AI Page Builder** — describe what you sell in chat, AI builds the payment page
2. **Voice-to-Storefront** — speak your product description, get a page
3. **Multi-Product Pages** — sell several products on one storefront
4. **PayPal Checkout** — real Orders API (create → capture)
5. **Smart Invoices** — PayPal Invoicing API (draft → send)
6. **Subscriptions** — recurring billing plans via PayPal
7. **Agentic Salesperson** — AI negotiates with buyers within YOUR price bounds
8. **Reasoning Sales Brain** — heuristic + real NVIDIA Nemotron via Nebius
9. **AI Support Bot** — answers buyer questions on every storefront
10. **AI Payment Reminders** — polite nudges for overdue invoices
11. **Pricing Coach** — AI suggests optimal pricing
12. **Analytics Dashboard** — views, revenue, conversion, top products
13. **AI Dispute Helper** — drafts dispute responses via real AI
14. **Discount Coupons** — create/apply codes, consumed only after successful capture
15. **Self-Healing PayPal Client** — exponential backoff retries + circuit breaker
16. **Abandoned Cart Recovery** — message-only nudges (max 1/cart), optional coupon sweetener
17. **Hindi ↔ English Translation** — real-time in agent chat, incl. Roman Hindi detection
18. **Smart Upsell** — max 1 per conversation, respects seller bounds
19. **Photo → Listing** — upload a product photo, AI generates the listing
20. **Return/Refund Agent + Price Watch** — seller-approved returns, competitor price alerts via Tavily

**Tests:** 144/144 passing (E2E + brain + recovery + translation + vision + returns + price-watch)
