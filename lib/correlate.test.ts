/**
 * Correlation, and the three rules that keep it from becoming a horoscope.
 *
 *   npx tsx lib/correlate.test.ts
 */

import assert from "node:assert/strict";
import { correlate } from "./correlate";
import type { FactMap } from "./cached-dossier";

const facts = (o: Record<string, string | number>): FactMap =>
  new Map(
    Object.entries(o).map(([k, v]) => [
      k,
      { value: String(v), sourceUrl: `https://example.com/${k}`, quote: null, confidence: 1 },
    ]),
  );

// --- every insight obeys the contract ------------------------------------
{
  const all = correlate(
    facts({
      "hiring.open_roles": 173,
      "hiring.function.sales": 68,
      "hiring.function.engineering": 66,
      "hiring.locations.count": 9,
      "pricing.has_custom": "true",
      "geo.locales.count": 4,
      "product.github.commits_52w": 2100,
      "product.github.latest_release_at": "2026-11-01",
      "discovered.compliance_claims": "true",
      "security.dmarc_policy": "reject",
      "security.scorecard.score": 7.1,
      "security.advisories.count": 12,
      "security.advisories.worst_severity": "critical",
      "security.disclosures.count": 9,
      "financial.revenue.yoy_pct": 29.8,
    }),
  );

  assert.ok(all.length >= 5, `expected several insights, got ${all.length}`);

  for (const i of all) {
    // RULE 2: the innocent reading is mandatory, not a nicety.
    assert.ok(i.alternative.length > 30, `${i.id} must carry a real alternative explanation`);
    assert.ok(i.limitation.length > 20, `${i.id} must state what it cannot tell you`);

    // RULE 1: two sources minimum. One adapter restated is not a correlation.
    assert.ok(i.evidence.length >= 2, `${i.id} must rest on at least two observations`);
    for (const e of i.evidence) {
      assert.ok(e.source, `${i.id}: evidence "${e.label}" must carry its source`);
      assert.ok(e.value !== "", `${i.id}: evidence "${e.label}" must carry a value`);
    }

    /*
     * RULE 3: no causal language. "Because" and "caused" are the words that
     * turn a co-occurrence into a claim we cannot support.
     */
    const prose = `${i.headline} ${i.soWhat}`.toLowerCase();
    for (const banned of ["because", "caused", "due to", "proves", "means that"]) {
      assert.ok(!prose.includes(banned), `${i.id} uses causal language: "${banned}"`);
    }
  }

  /*
   * Copy must not assert a count the evidence does not support. The
   * enterprise-readiness alternative said "All three" when only two signals
   * had fired, which is a small fabrication in the one place that is supposed
   * to be the honest half of the card.
   */
  for (const i of all) {
    for (const n of ["All three", "all three", "both of"]) {
      assert.ok(!i.alternative.includes(n), `${i.id}: alternative hard-codes a count ("${n}")`);
    }
  }

  // Unique ids, or the UI renders duplicate keys.
  assert.equal(new Set(all.map((i) => i.id)).size, all.length);
}

// --- silence is the correct output for a thin company --------------------
{
  /*
   * A correlation engine that always finds something is a horoscope. With one
   * lonely fact there is nothing to correlate, and the honest output is none.
   */
  assert.deepEqual(correlate(facts({ "hiring.open_roles": 3 })), []);
  assert.deepEqual(correlate(new Map()), []);

  // One source is never enough on its own.
  assert.deepEqual(
    correlate(facts({ "hiring.function.sales": 40, "hiring.open_roles": 40 })),
    [],
    "hiring alone must not produce a go-to-market insight — pricing is the second source",
  );
}

// --- a falling figure must not be dressed as growth ---------------------
{
  const down = correlate(facts({ "financial.revenue.yoy_pct": -14.2, "hiring.open_roles": 12 }));
  const g = down.find((i) => i.id === "filed-growth")!;
  assert.ok(g, "a decline must still be reported");
  assert.equal(g.tone, "warn");
  assert.match(g.headline, /fell/);
}

// --- disclosure maturity is not punished --------------------------------
{
  /*
   * The naive reading of an advisory count is backwards: a vendor publishing
   * its own high-severity advisories is running a security process. Tone must
   * reflect that rather than flagging maturity as risk.
   */
  const discloser = correlate(
    facts({
      "security.advisories.count": 20,
      "security.advisories.worst_severity": "critical",
      "security.disclosures.count": 15,
    }),
  ).find((i) => i.id === "security-disclosure")!;
  assert.equal(discloser.tone, "good");

  const silent = correlate(
    facts({ "security.advisories.count": 20, "security.advisories.worst_severity": "critical" }),
  ).find((i) => i.id === "security-disclosure")!;
  assert.equal(silent.tone, "warn", "no disclosure process is the one worth flagging");
}

console.log("✓ correlate: two sources minimum, alternatives mandatory, no causal language, silence when thin");
