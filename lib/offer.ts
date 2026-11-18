/**
 * The offer.
 *
 * One rule governs this file: **every number shown must be real.** A ladder
 * that does not move, a counter that does not count, or "47 seats left" from a
 * hardcoded constant are unfalsifiable urgency, and a careful buyer can
 * usually tell. Unverifiable scarcity costs more trust than it buys.
 *
 * The pricing follows one decision: **give away the present, charge for the
 * past.** Anyone can read a competitor's pricing page today, so charging for
 * current state is charging for nothing — and giving it away is the entire
 * acquisition engine. History cannot be regenerated without having watched,
 * which is why it is the thing that is paid for.
 */

/** Monthly subscription tiers. */
export type Tier = {
  slug: string;
  name: string;
  /** USD per month. 0 = free, null = the lifetime deal priced separately. */
  monthly: number | null;
  /** Companies on a watchlist. */
  companies: number;
  /** Combined API + MCP calls per day. */
  calls: number;
  /** How far back the change history goes. */
  history: string;
  seats: number;
  /** One line on who it is for. Kept short on purpose. */
  who: string;
  /** Only what this tier adds over the one below it. */
  adds: readonly string[];
};

/**
 * Company count and programmatic access are INDEPENDENT axes.
 *
 * A developer who wants MCP inside an agent may track five companies, while an
 * agency tracking two hundred may never touch the API. Gating the API behind a
 * high tier mismatches both, so API and MCP are in the first paid tier and the
 * daily call quota does the protecting.
 */
export const TIERS: readonly Tier[] = [
  {
    slug: "free",
    name: "Free",
    monthly: 0,
    companies: 3,
    calls: 25,
    history: "30 days",
    seats: 1,
    who: "See whether the data is any good.",
    adds: ["Public pages, no account", "Weekly refresh", "MCP server included"],
  },
  {
    slug: "starter",
    name: "Starter",
    monthly: 19,
    companies: 50,
    calls: 250,
    history: "Full, back-filled",
    seats: 1,
    who: "One marketer or PM watching a category.",
    adds: ["Full history, back-filled", "12-hour refresh", "Email alerts", "REST API + MCP"],
  },
  {
    slug: "pro",
    name: "Pro",
    monthly: 49,
    companies: 200,
    calls: 2_000,
    history: "Full, back-filled",
    seats: 3,
    who: "A team that acts on what it finds.",
    adds: ["Webhook alerts", "CSV and bulk export", "3 seats"],
  },
  {
    slug: "agency",
    name: "Agency",
    monthly: 149,
    companies: 1_000,
    calls: 10_000,
    history: "Full, back-filled",
    seats: 10,
    who: "Agencies and analysts covering many clients.",
    adds: ["Slack delivery", "10 seats", "Priority back-fill"],
  },
] as const;

export const tierBySlug = (slug: string) => TIERS.find((t) => t.slug === slug) ?? null;

/** What the lifetime deal grants. Bounded on purpose: we carry its cost forever. */
export const LIFETIME_GRANTS = "pro";

/** Base lifetime price, before any rungs have been climbed. */
export const BASE_PRICE = 199;

/** The ladder: every N sales, the price rises by STEP. */
export const SALES_PER_STEP = 10;
export const STEP = 10;

/**
 * The lifetime deal closes for good on this date, after which only the monthly
 * tiers remain. Same day the hackathon ends, which is not a coincidence: the
 * deadline is real and externally verifiable, which is what makes it work.
 */
export const DEAL_ENDS = new Date("2026-12-16T13:00:00Z");

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

/** Months of Pro that the lifetime price equals. Real arithmetic, not a claim. */
export const LIFETIME_PAYBACK_MONTHS = Math.round(BASE_PRICE / (tierBySlug("pro")!.monthly ?? 49));

/** The guarantee, in one place so the page and the FAQ cannot drift apart. */
export const REFUND = "14-day refund. One email, no forms, no questions.";

/**
 * Where "Get lifetime access" goes.
 *
 * A Creem hosted payment link (https://creem.io/payment/prod_xxx), so taking
 * money needs no checkout code of our own. Set the product ID and it goes
 * live; until then the button points at the free surface rather than a dead
 * link.
 * ponytail: no checkout API call. Add one only if we need per-customer
 * metadata or dynamic pricing at the till, which a fixed price doesn't.
 */
export const CREEM_PRODUCT_ID = process.env.NEXT_PUBLIC_CREEM_PRODUCT_ID ?? "";

export const CHECKOUT_URL = CREEM_PRODUCT_ID
  ? `https://creem.io/payment/${CREEM_PRODUCT_ID}`
  : "/stack";

export const CHECKOUT_READY = CREEM_PRODUCT_ID !== "";

/**
 * Free calls per user per day, for display in client components.
 *
 * Duplicated from usage-store's FREE_ROWS_PER_USER on purpose: that module
 * imports the 121k-domain disposable-email list, which must never reach the
 * browser bundle. The server value stays authoritative; license.test.ts
 * asserts these two cannot drift.
 */
export const FREE_ROWS = 25;

/** The same number, named for what it actually meters now. */
export const FREE_CALLS_PER_DAY = FREE_ROWS;

// ---------------------------------------------------------------------------
// Custom plans
// ---------------------------------------------------------------------------

/**
 * Rates for a plan built to order.
 *
 * A custom plan is an EXTENSION of the largest standard tier, never an
 * alternative to the smaller ones. The first formula tried was a flat
 * per-unit model, and it quoted $15 for Starter's exact specification against
 * a listed $19 — so the configurator undercut the price list and every buyer
 * would have routed around it. Pricing the excess over Agency instead means a
 * custom quote can never be cheaper than the tier it builds on.
 *
 * The rates are low because `companies` is deduped globally: the marginal cost
 * of a customer tracking Notion or Slack is ~zero, and cost is driven by
 * long-tail unique companies and by call volume, not by headcount.
 *
 * A quote is an estimate we will honour, not a number designed to anchor.
 */
export const CUSTOM = {
  /** Per company beyond the top tier's allowance. */
  perCompany: 0.065,
  /** Per call of daily quota beyond the top tier's allowance. */
  perCall: 0.003,
  /** Per seat beyond the top tier's allowance. */
  perSeat: 5,
  limits: { companies: 5_000, calls: 100_000, seats: 50 },
} as const;

/** The tier a custom plan extends: the largest standard one. */
export const TOP_TIER = TIERS[TIERS.length - 1];

export type PlanRequest = { companies: number; calls: number; seats: number };

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.floor(n) : lo));

export function normalisePlan(r: PlanRequest): PlanRequest {
  return {
    companies: clamp(r.companies, 1, CUSTOM.limits.companies),
    calls: clamp(r.calls, 25, CUSTOM.limits.calls),
    seats: clamp(r.seats, 1, CUSTOM.limits.seats),
  };
}

/**
 * Monthly price for a built-to-order plan.
 *
 * Only the EXCESS over the top tier is charged, so the quote is monotonic and
 * always at least the top tier's price.
 */
export function customPrice(req: PlanRequest): number {
  const r = normalisePlan(req);
  const over = (actual: number, included: number) => Math.max(0, actual - included);
  const extra =
    over(r.companies, TOP_TIER.companies) * CUSTOM.perCompany +
    over(r.calls, TOP_TIER.calls) * CUSTOM.perCall +
    over(r.seats, TOP_TIER.seats) * CUSTOM.perSeat;
  return Math.round((TOP_TIER.monthly ?? 149) + extra);
}

/**
 * The cheapest STANDARD tier that covers a request, if one does.
 *
 * This exists so the configurator can talk a customer out of a custom plan.
 * Quoting someone for something Pro already covers is a worse outcome than the
 * smaller sale: they find out later, and then the pricing page was the thing
 * that misled them.
 */
export function tierCovering(req: PlanRequest): Tier | null {
  const r = normalisePlan(req);
  return (
    TIERS.find(
      (t) => t.companies >= r.companies && t.calls >= r.calls && t.seats >= r.seats,
    ) ?? null
  );
}

/** A standard tier whenever one fits; a quote only when none does. */
export function bestPlan(req: PlanRequest):
  | { kind: "tier"; tier: Tier; monthly: number }
  | { kind: "custom"; monthly: number } {
  const tier = tierCovering(req);
  if (tier && tier.monthly !== null) return { kind: "tier", tier, monthly: tier.monthly };
  return { kind: "custom", monthly: customPrice(req) };
}
