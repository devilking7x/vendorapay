# Vendora Pay AI — Devpost Submission Draft (PayPal AI Hackathon)
<!-- Copy-paste ready. Deadline: Nov 12, 2026, 12:00 PM PT (= Nov 13, 01:30 AM IST) -->

## Title
Vendora Pay AI

## Tagline
Sell anything, anywhere — just describe it. AI builds your storefront, PayPal handles the money, an agent closes the sale.

## Description

**The problem:** Freelancers and creators worldwide lose sales to friction — building a storefront takes days, checkout integration takes longer, and follow-ups on unpaid invoices never happen.

**The solution:** Vendora Pay AI is a conversational storefront builder with a **real PayPal integration** and an **agentic AI salesperson** that runs the whole sale autonomously.

### What it does (20 features, all live, 144/144 tests passing)

**Sell:** AI Page Builder (chat) · Voice-to-Storefront · Photo → Listing (AI writes the listing from a product photo) · Multi-Product Pages
**Get paid:** PayPal Checkout — real Orders API (create → capture) · Smart Invoices — PayPal Invoicing API · Subscriptions — recurring billing · Discount Coupons (single-use, consumed only on successful capture)
**The agentic loop:** 🤖 Agentic Salesperson — chats with buyers, negotiates **within seller-set bounds**, sends invoices, follows up till paid; **never charges without seller confirmation** · Reasoning Sales Brain (heuristic + NVIDIA Nemotron via Nebius) · AI Support Bot on every page · Abandoned Cart Recovery (message-only nudges, max 1/cart, optional coupon sweetener) · Smart Upsell (1/conversation) · Hindi ↔ English real-time translation in agent chat (incl. Roman Hindi detection)
**Run the business:** Analytics Dashboard · AI Payment Reminders · Pricing Coach · AI Dispute Helper (real AI drafts) · Return/Refund Agent (seller-approved) · Competitor Price Watch (Tavily alerts) · Self-Healing PayPal Client (exponential-backoff retries + circuit breaker)

### The agentic commerce loop
Describe → AI builds page → buyer chats → agent negotiates → invoice sent → AI follows up → paid. The seller sets the limits; the agent does the work. Every decision is logged with its reasoning.

### Built with
PayPal Orders/Invoicing/Subscriptions APIs, NVIDIA Nemotron (via Nebius), Tavily, Node.js, TypeScript, Express, React, Vite, Tailwind CSS

## Live demo
https://vendorapay.onrender.com

## Repo
https://github.com/devilking7x/vendorapay

## Demo video
**Ready to upload:** `~/workspace/your_files/vendora-demo-video.mp4` — 2:11 (under the 3-min rule ✅), 720p, English voiceover. Upload it PUBLIC on YouTube, attach the thumbnail (`~/workspace/your_files/media-generation-vendora-yt-thumbnail-0-*.webp`), then paste the YouTube URL here.

**Uploaded:** https://youtu.be/Bpzuyr9XNX0 — **PUBLIC, verified playable** ✅ (logged-out browser check 2026-10-06 ~11:45 UTC; title: "Pay Al - Turn Words into a PayPal Storefront with an Al Salesperson | PayPal AlHackathon", 2:11). Safe to submit to Devpost.

**Suggested YouTube title:**
`Vendora Pay AI — AI Storefront Builder with PayPal | PayPal AI Hackathon`

**Suggested YouTube description (paste as-is):**
```
Vendora Pay AI — sell anything, anywhere. Just describe it.

An AI storefront builder for freelancers & creators: chat or speak what you sell, get a payment page, and let an agentic AI salesperson negotiate, invoice and follow up until paid — with PayPal handling the money.

🔴 Live demo: https://vendorapay.onrender.com
💻 Code: https://github.com/devilking7x/vendorapay
🏆 Built for the PayPal AI Hackathon 2026

Note: recorded against a local build of the same code (address bar shows localhost); the deployed site above runs the real PayPal sandbox integration.
```
