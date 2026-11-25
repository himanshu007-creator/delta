/**
 * The company intelligence profile: what we know, what is partial, what is
 * missing, and why.
 *
 * This exists because a dossier that renders only the sections it has data
 * for is quietly dishonest. A reader cannot tell the difference between "this
 * company publishes no pricing" and "we did not manage to read their pricing
 * page", and those are opposite claims. Worse, the page looks complete either
 * way — the missing section simply is not there to notice.
 *
 * So coverage is itself a first-class output. Every category reports one of
 * three states and always says why, including when the answer is that the
 * company genuinely has nothing to report.
 */

import type { FactMap } from "./cached-dossier";

export type CoverageStatus = "available" | "partial" | "missing";

export type Coverage = {
  key: string;
  label: string;
  status: CoverageStatus;
  /** Why it is in this state. Never blank, including when available. */
  detail: string;
  /** The most recent date any fact in this category carries, if any. */
  asOf: string | null;
};

const has = (f: FactMap, p: string) => f.get(p)?.value !== undefined && f.get(p)?.value !== null;
const str = (f: FactMap, p: string): string | null => f.get(p)?.value ?? null;
const num = (f: FactMap, p: string): number | null => {
  const v = f.get(p)?.value;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const anyPrefix = (f: FactMap, prefix: string) => {
  for (const k of f.keys()) if (k.startsWith(prefix)) return true;
  return false;
};

/**
 * Coverage per category.
 *
 * `partial` is the load-bearing state and it is used precisely: it means we
 * resolved the subject but not the detail. A company we know files with the
 * SEC but whose figures did not arrive is partial; a private company is not
 * partial, it is complete — there is nothing there to find.
 */
export function coverageOf(f: FactMap): Coverage[] {
  const out: Coverage[] = [];

  // --- financial ---------------------------------------------------------
  const secChecked = has(f, "corporate.sec.filer");
  const figures = has(f, "financial.revenue") || has(f, "financial.revenue_alt") || has(f, "financial.net_income");
  out.push({
    key: "financial",
    label: "Financial intelligence",
    status: figures ? "available" : secChecked && str(f, "corporate.sec.filer") === "false" ? "available" : secChecked ? "partial" : "missing",
    detail: figures
      ? "Figures taken from filed annual reports, with reporting periods."
      : secChecked && str(f, "corporate.sec.filer") === "false"
        ? "Checked: no US annual report names this company. Private companies file nothing, so there is nothing to find."
        : secChecked
          ? "Identified as a filer, but the figures did not arrive on this read."
          : "The filing index did not answer, so we cannot say whether they file.",
    asOf: str(f, "financial.revenue.filed") ?? str(f, "financial.revenue_alt.filed"),
  });

  // --- security ----------------------------------------------------------
  const advisories = has(f, "security.advisories.count");
  const posture = has(f, "security.dmarc_policy") || has(f, "security.scorecard.score");
  out.push({
    key: "security",
    label: "Security intelligence",
    status: advisories && posture ? "available" : advisories || posture ? "partial" : "missing",
    detail: advisories
      ? "Advisories against a package they publish, plus public posture."
      : posture
        ? "Public posture only. No package or repository of theirs was resolved, so no advisories can be attributed to them."
        : "No owned package or repository found, and no public posture readable.",
    asOf: str(f, "security.advisories.latest"),
  });

  // --- product -----------------------------------------------------------
  const pricing = str(f, "pricing.visible") === "true";
  const api = has(f, "product.api.endpoints");
  const releases = anyPrefix(f, "product.github.") || has(f, "product.llmstxt.sections");
  const productBits = [pricing, api, releases].filter(Boolean).length;
  out.push({
    key: "product",
    label: "Product intelligence",
    status: productBits >= 2 ? "available" : productBits === 1 ? "partial" : "missing",
    detail: productBits >= 2
      ? "Published pricing, developer surface and release signals all readable."
      : productBits === 1
        ? "Only one product surface is public; the rest are behind a login or not published."
        : "No public pricing, API surface or release feed found.",
    asOf: null,
  });

  // --- customer ----------------------------------------------------------
  /*
   * Deliberately the weakest category, and it says so.
   *
   * Named customers, churn and win/loss are what a buyer most wants and what
   * public sources support least. Vendor records prove a relationship exists
   * in the other direction — who THEY buy from — which is not the same thing
   * and must not be presented as a customer list.
   */
  const vendors = num(f, "stack.vendors.count") ?? 0;
  const reviews = has(f, "reviews.appstore.rating") || has(f, "reviews.wordpress.rating");
  out.push({
    key: "customer",
    label: "Customer intelligence",
    status: reviews && vendors > 0 ? "partial" : vendors > 0 || reviews ? "partial" : "missing",
    detail: vendors > 0
      ? `Vendor relationships (${vendors}) show who they buy from, not who buys from them. Named customers, churn and win/loss are not available from public sources.`
      : "Named customers, churn and win/loss are not available from public sources.",
    asOf: null,
  });

  // --- workforce ---------------------------------------------------------
  const roles = num(f, "hiring.open_roles");
  out.push({
    key: "workforce",
    label: "Workforce intelligence",
    status: roles !== null && roles > 0 ? "available" : "missing",
    detail: roles !== null && roles > 0
      ? "Open roles from their own job board, classified by function and seniority."
      : "No public job board was found on their site, so hiring is not readable.",
    asOf: null,
  });

  // --- legal -------------------------------------------------------------
  const insolvency = num(f, "legal.insolvency.notices");
  const legalName = str(f, "corporate.legal_name");
  out.push({
    key: "legal",
    label: "Legal and regulatory",
    status: insolvency !== null ? "available" : legalName ? "partial" : "missing",
    detail: insolvency !== null
      ? "Insolvency register searched against the registered legal name."
      : legalName
        ? "Legal entity resolved, but it is outside the registers we can search without a key."
        : "No registered legal entity could be resolved, so no register can be searched safely.",
    asOf: null,
  });

  // --- market ------------------------------------------------------------
  const named = num(f, "market.competitors.named_count");
  out.push({
    key: "market",
    label: "Competitive landscape",
    status: named !== null && named > 0 ? "available" : "missing",
    detail: named !== null && named > 0
      ? `${named} competitors named by the company itself on its own comparison pages.`
      : "They publish no comparison pages, so they name no competitors. Market share and TAM are not available from free public sources at all.",
    asOf: null,
  });

  return out;
}

/** For the headline: how much of the picture we actually have. */
export const coverageSummary = (c: Coverage[]) => ({
  available: c.filter((x) => x.status === "available").length,
  partial: c.filter((x) => x.status === "partial").length,
  missing: c.filter((x) => x.status === "missing").length,
  total: c.length,
});

// ---------------------------------------------------------------------------
// Normalised pricing
// ---------------------------------------------------------------------------

export type PricingTier = {
  slug: string;
  name: string;
  /** Monthly-equivalent cost in minor units, already normalised upstream. */
  monthlyMinor: number | null;
  perSeat: boolean;
  annualDiscountPct: number | null;
  source: string | null;
};

export type PricingLadder = {
  /**
   * What the page served. It may be an ISO code ("USD") or a bare symbol
   * ("$"), because that is what the extractor observed — normalising it to a
   * code would be asserting a currency we were not told.
   */
  currency: string;
  tiers: PricingTier[];
  hasFree: boolean;
  hasCustom: boolean;
  cheapestPaidMinor: number | null;
  /** Which extraction layer answered — structured data beats a text scan. */
  basis: string | null;
};

/**
 * The published ladder, normalised for comparison.
 *
 * `monthly_equivalent_minor` already exists per tier, which is the hard part:
 * "$9/seat/month billed annually" and "$108/seat/year" are the same deal
 * written two ways and comparing them raw is a real bug the extractor already
 * solves. This only assembles the result.
 *
 * Enterprise tiers carry no number on purpose. A contact-sales price is not
 * public, and inventing one is the single most tempting fabrication in
 * competitive pricing work.
 */
/** A symbol for display, and whether the observed value was already a code. */
export const currencySymbol = (c: string) =>
  c === "GBP" || c === "£" ? "£" : c === "EUR" || c === "€" ? "€" : c === "INR" || c === "₹" ? "₹" : c === "USD" || c === "$" ? "$" : c;
export const isCurrencyCode = (c: string) => /^[A-Z]{3}$/.test(c);

export function pricingLadderOf(f: FactMap): PricingLadder | null {
  if (str(f, "pricing.visible") !== "true") return null;

  const tiers = new Map<string, PricingTier>();
  for (const [path, fact] of f) {
    const m = /^pricing\.tier\.([a-z0-9-]+)\.([a-z0-9-]+)\.name$/.exec(path);
    if (!m) continue;
    const [, line, slug] = m;
    const base = `pricing.tier.${line}.${slug}`;
    tiers.set(base, {
      slug,
      name: fact.value ?? slug,
      monthlyMinor: num(f, `${base}.monthly_equivalent_minor`) ?? num(f, `${base}.monthly_minor`),
      perSeat: str(f, `${base}.per_seat`) === "true",
      annualDiscountPct: num(f, `pricing.annual_discount_pct.${line}.${slug}`),
      source: fact.sourceUrl,
    });
  }

  const list = [...tiers.values()].sort(
    (a, b) => (a.monthlyMinor ?? Number.MAX_SAFE_INTEGER) - (b.monthlyMinor ?? Number.MAX_SAFE_INTEGER),
  );
  if (list.length === 0) return null;

  return {
    currency: str(f, "pricing.currency_observed") ?? "USD",
    tiers: list,
    hasFree: str(f, "pricing.has_free") === "true",
    hasCustom: str(f, "pricing.has_custom") === "true",
    cheapestPaidMinor: num(f, "pricing.cheapest_paid_minor"),
    basis: str(f, "pricing.extraction_source"),
  };
}
