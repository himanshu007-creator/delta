/**
 * Coverage and normalised pricing.
 *
 * The coverage model exists so a reader can tell "the company has nothing to
 * report" from "we failed to read it". Conflating those is the failure this
 * file guards, and it is the same one that had a public company described as
 * not filing with the SEC.
 *
 *   npx tsx lib/profile.test.ts
 */

import assert from "node:assert/strict";
import { coverageOf, coverageSummary, pricingLadderOf } from "./profile";
import type { FactMap } from "./cached-dossier";

const facts = (o: Record<string, string | number | boolean>): FactMap =>
  new Map(
    Object.entries(o).map(([k, v]) => [
      k,
      { value: String(v), sourceUrl: `https://example.com/${k}`, quote: null, confidence: 1 },
    ]),
  );
const area = (f: FactMap, key: string) => coverageOf(f).find((c) => c.key === key)!;

// --- "nothing to report" is not the same as "we failed" -----------------
{
  // Checked, and genuinely private. That is a COMPLETE answer, not a gap.
  const priv = area(facts({ "corporate.sec.filer": false }), "financial");
  assert.equal(priv.status, "available");
  assert.match(priv.detail, /Private companies file nothing/);

  // Never checked. This is a gap, and must not read as "private".
  const unknown = area(new Map(), "financial");
  assert.equal(unknown.status, "missing");
  assert.match(unknown.detail, /did not answer/);
  assert.ok(!/private/i.test(unknown.detail), "silence must never be reported as privacy");

  // A filer whose figures did not arrive is the genuine partial case.
  const partial = area(facts({ "corporate.sec.filer": true, "corporate.sec.cik": "0001477333" }), "financial");
  assert.equal(partial.status, "partial");

  const full = area(facts({ "corporate.sec.filer": true, "financial.revenue": 1000, "financial.revenue.filed": "2026-02-26" }), "financial");
  assert.equal(full.status, "available");
  assert.equal(full.asOf, "2026-02-26");
}

// --- every cell must explain itself -------------------------------------
{
  const all = coverageOf(facts({ "hiring.open_roles": 30, "pricing.visible": true }));
  for (const c of all) {
    assert.ok(c.detail.length > 25, `${c.key} must say WHY it is in this state, even when available`);
    assert.ok(["available", "partial", "missing"].includes(c.status));
  }
  const sum = coverageSummary(all);
  assert.equal(sum.available + sum.partial + sum.missing, sum.total, "every area must be counted once");
}

// --- vendors are who they BUY from, never customers ---------------------
{
  /*
   * The most tempting misread in the product. A DNS vendor record proves a
   * relationship in the other direction, and presenting it as a customer list
   * would invert the meaning of the whole category.
   */
  const c = area(facts({ "stack.vendors.count": 24 }), "customer");
  assert.notEqual(c.status, "available", "vendor records must never make customer intelligence complete");
  assert.match(c.detail, /who they buy from, not who buys from them/);
}

// --- normalised pricing -------------------------------------------------
{
  const f = facts({
    "pricing.visible": true,
    "pricing.currency_observed": "USD",
    "pricing.has_free": true,
    "pricing.has_custom": true,
    "pricing.extraction_source": "json-ld",
    "pricing.tier.default.free.name": "Free",
    "pricing.tier.default.free.monthly_equivalent_minor": 0,
    "pricing.tier.default.free.per_seat": false,
    "pricing.tier.default.pro.name": "Pro",
    "pricing.tier.default.pro.monthly_equivalent_minor": 1900,
    "pricing.tier.default.pro.per_seat": true,
    "pricing.annual_discount_pct.default.pro": 25,
    "pricing.tier.default.enterprise.name": "Enterprise",
    "pricing.tier.default.enterprise.per_seat": false,
  });
  const l = pricingLadderOf(f)!;
  assert.ok(l);
  assert.equal(l.tiers.length, 3);

  // Cheapest first, and the tier with no public price sorts last rather than
  // being treated as free.
  assert.deepEqual(l.tiers.map((t) => t.name), ["Free", "Pro", "Enterprise"]);
  assert.equal(l.tiers[2].monthlyMinor, null, "a contact-sales tier must carry NO number");
  assert.equal(l.tiers[1].monthlyMinor, 1900);
  assert.equal(l.tiers[1].perSeat, true);
  assert.equal(l.tiers[1].annualDiscountPct, 25);
  assert.equal(l.basis, "json-ld");

  // No published pricing means no ladder, not an empty one.
  assert.equal(pricingLadderOf(facts({ "pricing.visible": false })), null);
  assert.equal(pricingLadderOf(new Map()), null);
}

console.log("✓ profile: coverage separates 'nothing to report' from 'could not read', pricing normalised, no invented enterprise price");
