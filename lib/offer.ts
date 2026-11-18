/**
 * The offer.
 *
 * Modelled on the structure that currently sits at #1 on the Ship or Die
 * leaderboard: pay once, a price that climbs with sales, a hard deadline, and
 * a refund instead of a trial. The mechanics are copied; the numbers and the
 * claims are ours.
 *
 * One rule governs this file: **every number shown must be real.** A ladder
 * that does not move, a counter that does not count, or "47 seats left" from
 * a hardcoded constant are unfalsifiable urgency, and a careful buyer can
 * usually tell. Unverifiable scarcity costs more trust than it buys.
 */

/** Base price, before any rungs have been climbed. */
export const BASE_PRICE = 99;

/** The ladder: every N sales, the price rises by STEP. */
export const SALES_PER_STEP = 10;
export const STEP = 10;

/**
 * The lifetime deal closes for good on this date, after which it becomes a
 * subscription. Same day the hackathon ends, which is not a coincidence: the
 * deadline is real and externally verifiable, which is what makes it work.
 */
export const DEAL_ENDS = new Date("2026-12-16T13:00:00Z");

/** What it becomes afterwards. */
export const AFTER_PRICE = 29;

/** Rows a licence includes per month. Stated up front; lifetime deals without a cap get abused. */
export const ROWS_PER_MONTH = 25_000;

export function priceAfterSales(sales: number): number {
  const safe = Number.isFinite(sales) && sales > 0 ? Math.floor(sales) : 0;
  return BASE_PRICE + Math.floor(safe / SALES_PER_STEP) * STEP;
}

/** Sales still to go before the next rung. Drives the honest urgency line. */
export function salesUntilNextStep(sales: number): number {
  const safe = Number.isFinite(sales) && sales > 0 ? Math.floor(sales) : 0;
  return SALES_PER_STEP - (safe % SALES_PER_STEP);
}

export function daysUntilDeadline(now: Date = new Date()): number {
  return Math.max(0, Math.ceil((DEAL_ENDS.getTime() - now.getTime()) / 86_400_000));
}

export const dealIsOpen = (now: Date = new Date()) => now < DEAL_ENDS;

/**
 * What the alternatives cost for the same work, from their own published
 * pricing. Dated, because a comparison without a date is a claim a buyer
 * cannot check — and the disclaimer below is not decoration.
 */
export const COMPARISON = {
  contacts: 10_000,
  verifiedOn: "18 Nov 2026",
  rows: [
    { name: "Lyne.ai", note: "pay-as-you-go, published rate", perContact: 0.3 },
    { name: "Smartwriter", note: "$59/mo ÷ 400 lead credits", perContact: 0.1475 },
    { name: "Clay", note: "Launch plan, $185/mo", perContact: null, monthly: 185 },
  ],
  disclaimer:
    "Prices are from each tool's public pricing page on 18 Nov 2026. Their plans include features we don't, and theirs may change. We're not affiliated with any of them.",
} as const;

/** The guarantee, in one place so the page and the FAQ cannot drift apart. */
export const REFUND = "14-day refund. One email, no forms, no questions.";

/**
 * Where "Get lifetime access" goes.
 *
 * A Creem hosted payment link (https://creem.io/payment/prod_xxx), so taking
 * money needs no checkout code of our own. Set CREEM_PRODUCT_ID and it goes
 * live; until then the button points at the free tier rather than a dead link.
 * ponytail: no checkout API call. Add one only if we need per-customer
 * metadata or dynamic pricing at the till, which a fixed one-time price doesn't.
 */
export const CREEM_PRODUCT_ID = process.env.NEXT_PUBLIC_CREEM_PRODUCT_ID ?? "";

export const CHECKOUT_URL = CREEM_PRODUCT_ID
  ? `https://creem.io/payment/${CREEM_PRODUCT_ID}`
  : "/run";

export const CHECKOUT_READY = CREEM_PRODUCT_ID !== "";

/**
 * Free rows per user, for display in client components.
 *
 * Duplicated from usage-store's FREE_ROWS_PER_USER on purpose: that module
 * imports the 121k-domain disposable-email list, which must never reach the
 * browser bundle. The server value stays authoritative; license.test.ts
 * asserts these two cannot drift.
 */
export const FREE_ROWS = 25;
