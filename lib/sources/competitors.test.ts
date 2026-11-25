/**
 * Competitor discovery, and the three false positives that shaped it.
 *
 * Every rejected case below is a real URL from a real sitemap. A naive
 * "contains vs" match accepts all three and would publish Visual Studio Code
 * as a competitor of Linear.
 *
 *   npx tsx lib/sources/competitors.test.ts
 */

import assert from "node:assert/strict";
import { competitorFacts, namedCompetitors } from "./competitors";

// --- the true positive ---------------------------------------------------
{
  const locs = [
    "https://writesonic.com/compare/writesonic-vs-ahrefs",
    "https://writesonic.com/compare/writesonic-vs-airops",
    "https://writesonic.com/compare/writesonic-vs-copyai",
    "https://writesonic.com/compare/writesonic-vs-jasper",
    "https://writesonic.com/blog/how-to-write",
  ];
  assert.deepEqual(namedCompetitors(locs, "writesonic.com"), ["ahrefs", "airops", "copyai", "jasper"]);

  const f = competitorFacts(locs, "writesonic.com", "https://writesonic.com/sitemap.xml");
  assert.equal(f.find((x) => x.path === "market.competitors.named_count")?.value, 4);
  assert.equal(f.find((x) => x.path === "market.competitors.named")?.value, "ahrefs,airops,copyai,jasper");
  for (const x of f) assert.ok(x.sourceUrl, "a competitor claim must point at where it came from");
}

// --- REGRESSION: "vs" that is not "versus" ------------------------------
{
  /*
   * linear.app/integrations/vs-code is Visual Studio Code. The slug starts
   * with "vs-", so there is no left-hand side to compare against.
   */
  const locs = [
    "https://linear.app/integrations/vs-code",
    "https://linear.app/integrations/vs-code-mcp",
  ];
  assert.deepEqual(namedCompetitors(locs, "linear.app"), [], "vs-code is an editor, not a comparison");
  assert.deepEqual(competitorFacts(locs, "linear.app", "u"), [], "no competitors must mean no facts");
}

// --- REGRESSION: comparing their own products ---------------------------
{
  /*
   * vercel.com/kb/guide/vercel-passport-vs-deployment-protection compares two
   * Vercel features. "vercel-passport" is not "vercel", so an exact brand
   * match rejects it — and the sub-brand guard catches the reverse ordering.
   */
  const locs = [
    "https://vercel.com/kb/guide/vercel-passport-vs-deployment-protection",
    "https://vercel.com/kb/guide/vercel-sandbox-vs-e2b",
  ];
  const got = namedCompetitors(locs, "vercel.com");
  assert.ok(!got.includes("deployment-protection"), "their own feature is not a competitor");
  assert.ok(!got.includes("vercel-sandbox"), "their own product is not a competitor");
}

// --- REGRESSION: generic technology explainers --------------------------
{
  /*
   * sql-vs-nosql names no company at all, and neither side is the brand.
   */
  const locs = [
    "https://vercel.com/kb/guide/sql-vs-nosql-databases",
    "https://vercel.com/kb/guide/eve-vs-ai-sdk-agents-vs-workflowagent",
  ];
  assert.deepEqual(namedCompetitors(locs, "vercel.com"), [], "generic tech comparisons name no competitor");

  // Even with the brand present, a known non-company term is dropped.
  assert.deepEqual(namedCompetitors(["https://x.com/p/acme-vs-sql"], "acme.com"), []);
  assert.deepEqual(namedCompetitors(["https://x.com/p/acme-vs-serverless"], "acme.com"), []);
}

// --- no domain is ever guessed ------------------------------------------
{
  /*
   * A slug is not a hostname. "copyai" is copy.ai and "jasper" is jasper.ai,
   * so appending .com would send a reader to the wrong company while looking
   * authoritative. Names only.
   */
  const f = competitorFacts(["https://writesonic.com/compare/writesonic-vs-copyai"], "writesonic.com", "u");
  const text = JSON.stringify(f);
  assert.ok(!text.includes("copyai.com"), "a competitor slug must never be turned into a domain");
  assert.ok(!/\/c\//.test(text), "no company-page link may be fabricated from a slug");
}

// --- shape and bounds ---------------------------------------------------
{
  // Order is stable, so an unchanged sitemap never records a fake change.
  const locs = ["https://a.com/x/acme-vs-zeta", "https://a.com/x/acme-vs-alpha"];
  assert.deepEqual(namedCompetitors(locs, "acme.com"), ["alpha", "zeta"]);

  // Deduplicated: the same rival named on several pages counts once.
  assert.deepEqual(
    namedCompetitors(["https://a.com/p/acme-vs-beta", "https://a.com/q/acme-vs-beta"], "acme.com"),
    ["beta"],
  );

  // Bounded, so a large comparison hub cannot write an unbounded fact.
  const many = Array.from({ length: 80 }, (_, i) => `https://a.com/p/acme-vs-r${String(i).padStart(2, "0")}`);
  const value = String(competitorFacts(many, "acme.com", "u").find((x) => x.path === "market.competitors.named")?.value);
  assert.equal(value.split(",").length, 40);

  // A two-letter brand matches too much to be evidence of anything.
  assert.deepEqual(namedCompetitors(["https://ab.com/p/ab-vs-zeta"], "ab.com"), []);
}

console.log("✓ competitors: named by the company itself, vs-code and sql-vs-nosql refused, no domain guessed");
