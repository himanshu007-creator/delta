/**
 * Filed financials, and the identity rule that gates them.
 *
 * The negative assertions carry the weight here. A wrong revenue figure
 * attached to the wrong company is worse than no revenue figure, and both
 * failure modes in this file are ones that actually occurred against live
 * data rather than ones imagined for a test.
 *
 *   npx tsx lib/sources/financial.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { annualSeries, resolveCik, secIdentity, FINANCIAL_ADAPTERS } from "./financial";
import { handlesFrom, PHASE2_KINDS, PUBLIC_KINDS } from "../public-dossier";
import { bigMoney, financialsOf } from "../interpret";
import type { FactMap } from "../cached-dossier";
import { byKind } from "./registry";
import type { Fact } from "./types";

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const val = (facts: Fact[], path: string) => facts.find((f) => f.path === path)?.value;

/** Facts as the dossier stores them, so the view model can be tested on real adapter output. */
const factMap = (facts: Fact[]): FactMap =>
  new Map(facts.map((f) => [f.path, {
    value: f.value === null || f.value === undefined ? null : String(f.value),
    sourceUrl: f.sourceUrl ?? null,
    quote: f.quote ?? null,
    confidence: f.confidence ?? null,
  }]));

// --- identity: resolved by filing, not by name ----------------------------
{
  // Sole filer. All 8 annual reports containing "cloudflare.com" are Cloudflare's own.
  const cf = resolveCik(fx("sec-fts-cloudflare.json"), "cloudflare.com");
  assert.equal(val(cf, "corporate.sec.cik"), "0001477333");
  assert.match(String(val(cf, "corporate.sec.registrant")), /Cloudflare/);

  /*
   * REGRESSION: shopify.com appears in TWO filers' 10-Ks — Shopify's own, and
   * MGO Global's, which names it as a sales platform. A sole-CIK rule alone
   * would have refused a genuinely public company; taking the first hit would
   * have published MGO Global's financials as Shopify's.
   */
  const shop = resolveCik(fx("sec-fts-shopify.json"), "shopify.com");
  assert.match(String(val(shop, "corporate.sec.registrant")), /SHOPIFY/i,
    "the registrant NAMED after the domain must win when several filers mention it");
  assert.ok(!String(val(shop, "corporate.sec.registrant")).match(/MGO/i),
    "a company that merely mentions the domain must never be adopted as its registrant");

  /*
   * A private company files nothing — and the resolver must RECORD that it
   * looked, rather than returning nothing.
   *
   * REGRESSION: returning [] made "we asked and there are no filings"
   * identical to "the request never completed". The page then told readers
   * that Cloudflare, a public company, does not file — a confidently wrong
   * claim that cached for hours because the figures had merely timed out.
   */
  const lin = resolveCik(fx("sec-fts-linear.json"), "linear.app");
  assert.equal(val(lin, "corporate.sec.filer"), false, "a completed check must leave evidence it ran");
  assert.equal(val(lin, "corporate.sec.cik"), undefined);
  assert.equal(financialsOf(factMap(lin)).notAFiler, true);
  assert.equal(financialsOf(factMap(lin)).checked, true);

  // No facts at all means UNKNOWN, and must never read as "private".
  const unknown = financialsOf(new Map());
  assert.equal(unknown.checked, false, "absent facts must not be mistaken for a finding");
  assert.equal(unknown.notAFiler, false, "silence is not evidence that a company is private");

  // A resolved filer also records that the check ran.
  assert.equal(val(cf, "corporate.sec.filer"), true);
  assert.equal(financialsOf(factMap(cf)).checked, true);
  assert.equal(financialsOf(factMap(cf)).notAFiler, false);

  /*
   * Ambiguous and NOT resolvable by name: must refuse. Two filers mention the
   * domain, neither is named after it. The product's whole claim is provenance,
   * so the honest output is a visible low-confidence lead with no CIK.
   */
  const ambiguous = resolveCik(
    {
      hits: {
        total: { value: 2 },
        hits: [
          { _source: { display_names: ["Acme Holdings Inc.  (ACME)  (CIK 0000000001)"] } },
          { _source: { display_names: ["Beta Partners LP  (CIK 0000000002)"] } },
        ],
      },
    },
    "gamma.com",
  );
  assert.equal(val(ambiguous, "corporate.sec.cik"), undefined, "an unresolved registrant must carry NO cik");
  assert.ok(String(val(ambiguous, "corporate.sec.candidates")).includes("Acme"));
  // By PATH, not by index: the fact order is not part of the contract.
  assert.equal(
    ambiguous.find((f) => f.path === "corporate.sec.candidates")!.confidence,
    0.4,
    "a lead must be marked as a lead",
  );

  // A brand too short to be distinctive must not be used to break a tie.
  const shortBrand = resolveCik(
    {
      hits: {
        total: { value: 2 },
        hits: [
          { _source: { display_names: ["AB Industries  (CIK 0000000003)"] } },
          { _source: { display_names: ["Unrelated Co  (CIK 0000000004)"] } },
        ],
      },
    },
    "ab.com",
  );
  assert.equal(val(shortBrand, "corporate.sec.cik"), undefined, "a 2-letter brand is not evidence of identity");
}

// --- annual series: the three ways a period key goes wrong ----------------
{
  const apple = fx("sec-concept-apple-revenue.json").units.USD;
  const series = annualSeries(apple);

  // Apple's FY2026 10-K restates FY2024 and FY2025 and stamps fy:2026 on all
  // three. Grouping by `fy` would collapse them to one row.
  assert.ok(series.length >= 3, `expected several annual periods, got ${series.length}`);
  const ends = series.map((r) => r.end);
  assert.equal(new Set(ends).size, ends.length, "one row per period end, never a duplicate period");
  assert.deepEqual([...ends].sort(), ends, "series must be oldest-first so the last row is the latest");

  const latest = series[series.length - 1];
  assert.equal(latest.end, "2026-09-26");
  assert.equal(latest.val, 478_834_000_000, "the exact figure as filed, not a rounded or derived one");
  assert.equal(latest.form, "10-K");

  // REGRESSION: a 10-Q carries FY-to-date rows tagged fp:"FY". Without the
  // 10-month span floor a quarter is read as a full year, and revenue appears
  // to collapse by ~75% in the quarter after year end.
  const quarters = apple.filter((r: { fp?: string; form?: string }) => r.form === "10-Q");
  assert.ok(quarters.length > 0, "the fixture must actually contain 10-Q rows for this to prove anything");
  assert.ok(
    series.every((r) => r.form === "10-K"),
    "no quarterly row may survive into the annual series",
  );

  // A second filer, so the parser is not fitted to one company's filing style.
  const cf = annualSeries(fx("sec-concept-cloudflare-revenue.json").units.USD);
  const cfLatest = cf[cf.length - 1];
  assert.equal(cfLatest.end, "2025-12-31");
  assert.equal(cfLatest.val, 2_167_937_000);
}

// --- the facts a reader actually sees -------------------------------------
{
  const rev = FINANCIAL_ADAPTERS.find((a) => a.kind === "financial.revenue")!;
  const url = "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/X.json";
  const facts = rev.extract(fx("sec-concept-apple-revenue.json"), {
    company: { domain: "apple.com", cik: "0000320193" },
    url,
    raw: "",
  });

  assert.equal(val(facts, "financial.revenue"), 478_834_000_000);
  assert.equal(val(facts, "financial.revenue.unit"), "USD");
  assert.equal(val(facts, "financial.revenue.period_end"), "2026-09-26");
  assert.equal(val(facts, "financial.revenue.form"), "10-K");
  assert.equal(val(facts, "financial.revenue.filed"), "2026-11-03");

  // 416,161 -> 478,834 is +15.1%.
  assert.equal(val(facts, "financial.revenue.yoy_pct"), 15.1);

  // Every published figure must be pointable-at. That is the entire product.
  for (const f of facts) {
    assert.ok(f.sourceUrl, `${f.path} must carry a source URL`);
  }
  const headline = facts.find((f) => f.path === "financial.revenue")!;
  assert.match(String(headline.quote), /478,834,000,000/, "the quote must contain the figure itself");
  assert.match(String(headline.quote), /10-K filed 2026-11-03/, "the quote must name the filing it came from");
  assert.equal(headline.confidence, 1, "a figure read from a filing is not a guess");

  // Growth against a zero or negative base is noise, not a trend.
  const noGrowth = rev.extract(
    { entityName: "X", units: { USD: [
      { start: "2024-01-01", end: "2024-12-31", val: 0, form: "10-K", fp: "FY", filed: "2025-02-01" },
      { start: "2025-01-01", end: "2025-12-31", val: 500, form: "10-K", fp: "FY", filed: "2026-02-01" },
    ] } },
    { company: { domain: "x.com", cik: "0000000009" }, url, raw: "" },
  );
  assert.equal(val(noGrowth, "financial.revenue"), 500);
  assert.equal(val(noGrowth, "financial.revenue.yoy_pct"), undefined, "no percentage against a zero base");

  // A foreign filer's own currency must never be relabelled USD.
  const eur = rev.extract(
    { entityName: "Y", units: { EUR: [
      { start: "2025-01-01", end: "2025-12-31", val: 1_000, form: "20-F", fp: "FY", filed: "2026-03-01" },
    ] } },
    { company: { domain: "y.com", cik: "0000000010" }, url, raw: "" },
  );
  assert.equal(val(eur, "financial.revenue.unit"), "EUR");
}

// --- the gate: no sound identity, no requests ----------------------------
{
  for (const a of FINANCIAL_ADAPTERS) {
    assert.equal(a.url({ domain: "linear.app" }), null, `${a.kind} must not fetch without a CIK`);
    assert.ok(a.url({ domain: "apple.com", cik: "0000320193" })?.includes("CIK0000320193"));
  }

  // handlesFrom is what turns phase one into phase two, so it must adopt only
  // a sound CIK — and the refusal fact deliberately carries none.
  assert.equal(handlesFrom("apple.com", [{ path: "corporate.sec.cik", value: "0000320193" }]).cik, "0000320193");
  assert.equal(
    handlesFrom("gamma.com", [{ path: "corporate.sec.candidates", value: "Acme | Beta" }]).cik,
    undefined,
    "an unresolved registrant must not unlock financial adapters",
  );
  assert.equal(
    handlesFrom("x.com", [{ path: "corporate.sec.cik", value: "320193" }]).cik,
    undefined,
    "a malformed CIK must be rejected, not padded or passed through",
  );

  // The wiring itself: the resolver must be in phase one and the figures in
  // phase two, or the dossier silently has no financials at all. This is the
  // bug the two-phase build exists to fix, so it is asserted rather than
  // assumed.
  assert.ok((PUBLIC_KINDS as readonly string[]).includes("corporate.sec"),
    "the CIK resolver must run in phase one");
  for (const k of PHASE2_KINDS) {
    assert.ok(byKind(k), `${k} is in PHASE2_KINDS but not in the catalog`);
    assert.equal(byKind(k)!.url({ domain: "d.com" }), null, `${k} must be handle-gated`);
  }
  assert.ok(secIdentity.url({ domain: "anything.com" }), "the resolver itself must apply to any domain");
}

// --- REGRESSION: a filer that switched revenue tags ----------------------
{
  /*
   * NVIDIA stopped filing the ASC 606 revenue tag after FY2022 and moved to
   * `Revenues`. Reading one tag only produced a 2022 revenue figure displayed
   * beside a 2026 net income — implying $120B of profit on $26.9B of revenue.
   * Nothing threw; the abandoned tag simply kept answering with its last good
   * year forever.
   */
  const r606 = annualSeries(fx("sec-concept-nvidia-rev606.json").units.USD);
  const rTotal = annualSeries(fx("sec-concept-nvidia-revenues.json").units.USD);
  const netInc = annualSeries(fx("sec-concept-nvidia-netincome.json").units.USD);

  assert.equal(r606.at(-1)!.end, "2022-01-30", "the abandoned tag still answers, which is the trap");
  assert.equal(rTotal.at(-1)!.end, "2026-01-25", "the live tag must carry the current year");
  assert.ok(rTotal.at(-1)!.val > r606.at(-1)!.val * 5, "and the two are nowhere near each other");

  // The view model must pick the tag reporting the LATER period.
  const facts: FactMap = new Map();
  const put = (path: string, value: string | number) =>
    facts.set(path, { value: String(value), sourceUrl: "https://data.sec.gov/x", quote: null, confidence: 1 });

  put("financial.revenue", r606.at(-1)!.val);
  put("financial.revenue.period_end", r606.at(-1)!.end);
  put("financial.revenue_alt", rTotal.at(-1)!.val);
  put("financial.revenue_alt.period_end", rTotal.at(-1)!.end);
  put("financial.net_income", netInc.at(-1)!.val);
  put("financial.net_income.period_end", netInc.at(-1)!.end);

  const fin = financialsOf(facts);
  const revenue = fin.figures.find((x) => x.label === "Revenue")!;
  assert.equal(revenue.value, rTotal.at(-1)!.val, "revenue must come from the tag with the later period");
  assert.equal(revenue.periodEnd, "2026-01-25");
  assert.ok(
    !fin.figures.some((x) => x.value === r606.at(-1)!.val && x.label === "Revenue" && !x.stale),
    "the stale tag's figure must never be presented as current revenue",
  );

  // Revenue must exceed net income once both are read from the same year.
  const ni = fin.figures.find((x) => x.label === "Net income")!;
  assert.ok(
    revenue.value > ni.value,
    `revenue ${revenue.value} must exceed net income ${ni.value} — the original bug reported the inverse`,
  );

  // Only ONE revenue line may ever reach the reader.
  assert.equal(fin.figures.filter((x) => x.label === "Revenue").length, 1);
}

// --- period coherence: no cross-year margin ------------------------------
{
  const facts: FactMap = new Map();
  const put = (path: string, value: string | number) =>
    facts.set(path, { value: String(value), sourceUrl: "https://data.sec.gov/x", quote: null, confidence: 1 });

  put("financial.revenue", 1_000);
  put("financial.revenue.period_end", "2026-12-31");
  put("financial.cash", 50);
  put("financial.cash.period_end", "2026-12-31");
  // Two years behind: real, filed, and not comparable.
  put("financial.equity", 900);
  put("financial.equity.period_end", "2024-12-31");

  const fin = financialsOf(facts);
  assert.equal(fin.latestPeriod, "2026-12-31");
  assert.equal(fin.mixedPeriods, true, "a lagging figure must be flagged, not blended");
  assert.equal(fin.figures.find((x) => x.label === "Shareholders' equity")!.stale, true);
  assert.equal(fin.figures.find((x) => x.label === "Revenue")!.stale, false);

  // All-same-period is the normal case and must NOT be flagged.
  const clean: FactMap = new Map();
  for (const [k, v] of facts) if (!k.startsWith("financial.equity")) clean.set(k, v);
  assert.equal(financialsOf(clean).mixedPeriods, false);
}

// --- bigMoney must not be the pricing formatter --------------------------
{
  // REGRESSION: `money` in this module converts MINOR units for pricing.
  // Running a filed revenue through it divides by 100 — $2.17B shown as $21.7M.
  assert.equal(bigMoney(2_167_937_000), "$2.17B");
  assert.equal(bigMoney(478_834_000_000), "$479B");
  assert.equal(bigMoney(-102_267_000), "($102M)", "a loss must be unmistakable, not a thin minus sign");
  assert.equal(bigMoney(1_000, "EUR"), "EUR 1.00K", "a foreign filer's currency must not become dollars");
}

console.log("✓ financial: identity by filing not name, tag switches survived, periods never blended, no figure without a source");
