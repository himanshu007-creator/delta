/**
 * Pricing extraction, against SIX real pages saved from the live web.
 *
 * A pricing parser tested on invented HTML proves nothing — every expectation
 * below is ground truth read off the actual page, and every negative assertion
 * is a false positive this parser really produced at some point.
 *
 *   npx tsx lib/sources/pricing.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPricing, monthlyEquivalentMinor, pricingFacts, type PricingShape } from "./pricing";

const load = (n: string) =>
  extractPricing(readFileSync(new URL(`./fixtures/pricing-${n}.html`, import.meta.url), "utf8"));

const tier = (s: PricingShape, name: string, line?: string) =>
  s.tiers.find((t) => t.name.toLowerCase() === name.toLowerCase() && (line === undefined || t.productLine === line));

// --- monday: layer 1, and the richest page we have -------------------------
{
  const s = load("monday");
  assert.equal(s.source, "json-ld", "monday publishes schema.org Offers — if this degrades to text, correctness has silently regressed");
  assert.equal(s.productLines.length, 4, "monday sells FOUR ladders on one page (Work Management, CRM, Dev, Service)");
  assert.equal(s.tiers.length, 16);

  const wm = "monday.com Work Management";
  assert.equal(tier(s, "Free", wm)?.monthly?.amountMinor, 0);
  assert.equal(tier(s, "Free", wm)?.isFree, true);

  // The monthly/annual pair, which is the whole point of this block.
  const basic = tier(s, "Basic", wm);
  assert.equal(basic?.monthly?.amountMinor, 1200, "Basic is $12 billed monthly");
  assert.equal(basic?.annual?.amountMinor, 900, "Basic is $9 under annual billing");
  assert.equal(basic?.annualBasis, "per-month", "$9 is a PER-MONTH rate under an annual commitment, not $9/year");
  assert.equal(basic?.perSeat, true);

  assert.equal(tier(s, "Standard", wm)?.monthly?.amountMinor, 1400);
  assert.equal(tier(s, "Standard", wm)?.annual?.amountMinor, 1200);
  assert.equal(tier(s, "Pro", wm)?.monthly?.amountMinor, 2400);
  assert.equal(tier(s, "Pro", wm)?.annual?.amountMinor, 1900);
  assert.equal(tier(s, "Enterprise", wm)?.isCustom, true, "Enterprise is a real tier with no public price");

  // Different lines price the SAME tier name differently — collapsing them was a real bug.
  assert.equal(tier(s, "Standard", "monday Service")?.annual?.amountMinor, 3100);
  assert.notEqual(
    tier(s, "Standard", wm)?.annual?.amountMinor,
    tier(s, "Standard", "monday Service")?.annual?.amountMinor,
    "Work Management Standard and Service Standard must not be merged",
  );

  // Promotional noise on this page: "Total of $120", "$12 x 10 seats", "$140".
  for (const bad of [12000, 14000, 9000 * 10]) {
    assert.ok(
      !s.tiers.some((t) => t.monthly?.amountMinor === bad || t.annual?.amountMinor === bad),
      `${bad} is a seat TOTAL or struck-through price, not a plan price`,
    );
  }
}

// --- linear: layer 3, and declarative shadow DOM ---------------------------
{
  const s = load("linear");
  // linear renders its whole ladder inside <template> (declarative shadow DOM).
  // Stripping templates lost Business and Enterprise entirely.
  assert.ok(tier(s, "Business"), "Business must be found inside <template>");
  assert.equal(tier(s, "Free")?.monthly?.amountMinor, 0);
  assert.equal(monthlyEquivalentMinor(tier(s, "Basic")!), 1000, "Basic is $10/user/month");
  assert.equal(monthlyEquivalentMinor(tier(s, "Business")!), 1600, "Business is $16/user/month");
  assert.equal(tier(s, "Basic")?.perSeat, true);

  // linear prints "$16" as three text nodes ("$", "1", "6"). A naive join
  // matched "$1" — a wrong price, which is worse than no price.
  assert.ok(
    !s.tiers.some((t) => [100, 600].includes(monthlyEquivalentMinor(t) ?? -1)),
    "split-digit prices must be reassembled, never read as $1 or $6",
  );
}

// --- notion: comparison-table phantoms ------------------------------------
{
  const s = load("notion");
  assert.equal(tier(s, "Free")?.monthly?.amountMinor, 0, "Free was being dropped by a nav-word guard bug");
  assert.equal(tier(s, "Plus")?.monthly?.amountMinor, 1000);
  assert.equal(tier(s, "Business")?.monthly?.amountMinor, 2000);
  assert.equal(tier(s, "Enterprise")?.isCustom, true);

  // The $8 Notion AI ADD-ON sat near feature rows labelled "Basic"/"Advanced"
  // in the comparison table and became two phantom tiers.
  assert.equal(tier(s, "Basic"), undefined, "the $8 Notion AI add-on must not become a 'Basic' tier");
  assert.equal(tier(s, "Advanced"), undefined, "nor an 'Advanced' tier");
  assert.ok(!s.tiers.some((t) => monthlyEquivalentMinor(t) === 800), "no tier should carry the $8 add-on price");
}

// --- figma: several seat classes per tier ----------------------------------
{
  const s = load("figma");
  assert.equal(monthlyEquivalentMinor(tier(s, "Professional")!), 1600);
  assert.equal(monthlyEquivalentMinor(tier(s, "Organization")!), 5500);
  assert.equal(monthlyEquivalentMinor(tier(s, "Enterprise")!), 9000);
  assert.equal(tier(s, "Professional")?.perSeat, true, "figma prices per seat, not per account");

  // "Full seat $16 /mo ... Dev seat $12 /mo" — the second price is a different
  // SEAT CLASS. Pairing them invented a 25% annual discount.
  assert.deepEqual(tier(s, "Professional")?.seatClasses, ["full", "dev"]);
  assert.equal(tier(s, "Professional")?.annual, null, "a dev-seat price is not an annual price");
}

// --- vercel: layer 2, and metered usage rates -----------------------------
{
  const s = load("vercel");
  assert.equal(s.source, "framework", "vercel's prices live in its RSC payload");
  assert.equal(tier(s, "Hobby")?.monthly?.amountMinor, 0);
  assert.equal(tier(s, "Pro")?.monthly?.amountMinor, 2000);
  assert.equal(tier(s, "Enterprise")?.isCustom, true);

  // $0.08 is a per-GB usage rate and $250 a credit bundle; both were tiers once.
  assert.ok(!s.tiers.some((t) => (monthlyEquivalentMinor(t) ?? 0) === 8), "a $0.08/GB usage rate is not a tier");
  assert.ok(!s.tiers.some((t) => t.name.toLowerCase() === "unlimited"), "'Unlimited $250' is not a tier");
}

// --- slack: honesty about a suspect pairing -------------------------------
{
  const s = load("slack");
  // Fetched from India, so the page localised to rupees. We record what we were
  // SHOWN and must never present it as the company's currency.
  assert.equal(s.currencyObserved, "₹", "currency is observed, not asserted");

  const facts = pricingFacts(s, "https://slack.com/pricing");
  const notes = facts.filter((f) => f.path === "pricing.note").map((f) => String(f.value));
  assert.ok(
    notes.some((n) => /implausible/i.test(n)),
    "a 55% implied annual discount means the pair is probably wrong — say so rather than publishing it confidently",
  );
  const discounts = facts.filter((f) => f.path.startsWith("pricing.annual_discount_pct."));
  assert.ok(discounts.every((f) => (f.confidence ?? 1) <= 0.4), "a dubious discount must carry low confidence");
}

// --- facts contract --------------------------------------------------------
{
  const facts = pricingFacts(load("monday"), "https://monday.com/pricing");
  const paths = new Set(facts.map((f) => f.path));
  for (const required of [
    "pricing.extraction_source", "pricing.tiers.count", "pricing.tiers.names",
    "pricing.lines.count", "pricing.has_free", "pricing.has_custom",
    "pricing.has_enterprise", "pricing.currency_observed", "pricing.fingerprint",
  ]) {
    assert.ok(paths.has(required), `missing fact: ${required}`);
  }
  assert.ok(
    [...paths].some((p) => /^pricing\.annual_discount_pct\./.test(p)),
    "the annual discount is derived, and it is the number marketers quote",
  );
  assert.ok(
    [...paths].some((p) => /\.monthly_equivalent_minor$/.test(p)),
    "one canonical comparable figure per tier is what /compare pages need",
  );
  // Provenance is not optional.
  assert.ok(facts.every((f) => f.sourceUrl), "every fact must carry its source URL");

  // The fingerprint is the change trigger: identical input, identical output.
  const again = pricingFacts(load("monday"), "https://monday.com/pricing");
  assert.equal(
    facts.find((f) => f.path === "pricing.fingerprint")?.value,
    again.find((f) => f.path === "pricing.fingerprint")?.value,
    "extraction must be deterministic or every window reports a fake change",
  );
}

console.log("✓ pricing: 6 real pages — tiers, monthly/annual, seat classes, product lines, and every false positive stays dead");
