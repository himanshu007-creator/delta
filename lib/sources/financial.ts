/**
 * Financial intelligence, from filings only.
 *
 * The rule this module exists to enforce: a financial figure is published ONLY
 * when a regulator-filed document supports it. There are no estimates, no
 * models and no "approximately" — a private company simply has no revenue
 * here, and that absence is the honest answer rather than a gap to fill.
 *
 * Which is also why funding and revenue never share a path. Conflating a
 * raised round with earned revenue is the single most common way company-intel
 * products mislead, and it is one rename away from happening by accident.
 *
 * Two SEC APIs, both keyless:
 *   1. efts.sec.gov full-text search  -> which CIK, if any, is this domain
 *   2. data.sec.gov companyconcept    -> one XBRL concept's full history
 */

import type { Adapter, Company, Fact } from "./types";
import { asObj, num, quote } from "./types";

/**
 * Identity, resolved by EVIDENCE rather than by name.
 *
 * The lesson is already paid for in this codebase: matching GLEIF on a name
 * gave linear.app a Belgian consultancy and stripe.com a Belgian namesake.
 * So we never ask "which registrant is named like this domain". We ask "which
 * registrant printed this domain in its own annual report", which is a fact
 * about a filing rather than a guess about a string.
 *
 * It still needs a tie-break, because a domain appears in OTHER companies'
 * filings too — shopify.com is in MGO Global's 10-K as a platform they sell
 * on. So: a sole CIK is sound; several CIKs are resolved only when exactly one
 * of them is also NAMED after the domain; anything else resolves to nothing
 * and says so.
 */
const BRAND = (domain: string) => domain.split(".")[0].replace(/[^a-z0-9]/g, "");
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type FtsHit = { _source?: { display_names?: string[] } };

export function resolveCik(body: unknown, domain: string): Fact[] {
  const hits = asObj<{ hits?: { total?: { value?: number }; hits?: FtsHit[] } }>(body).hits;
  const rows = Array.isArray(hits?.hits) ? hits.hits : [];
  const total = num(hits?.total?.value) ?? 0;

  // cik -> registrant name, as EDGAR prints it.
  const byCik = new Map<string, string>();
  for (const r of rows) {
    for (const label of r._source?.display_names ?? []) {
      const m = /CIK (\d{10})/.exec(label);
      if (m) byCik.set(m[1], label.split("  (")[0].trim());
    }
  }

  const sourceUrl = ftsUrl(domain);

  if (byCik.size === 0) {
    /*
     * Not a US filer — and this must be stated as a FACT rather than as an
     * absence of facts.
     *
     * The two are not interchangeable. "We asked EDGAR and it has no annual
     * report naming this domain" is a finding; "we have no SEC facts" is also
     * what an aborted request looks like. When the page could not tell them
     * apart it printed "does not appear as the filer" for Cloudflare, which
     * is a public company — a confidently wrong claim, cached for hours.
     */
    return [
      {
        path: "corporate.sec.filer",
        value: false,
        confidence: 1,
        sourceUrl,
        quote: quote(`No annual report on EDGAR full-text search contains ${domain}`),
      },
    ];
  }
  const emit = (cik: string, name: string, confidence: number, why: string): Fact[] => [
    { path: "corporate.sec.filer", value: true, confidence: 1, sourceUrl },
    { path: "corporate.sec.cik", value: cik, confidence, sourceUrl, quote: quote(`${name} (CIK ${cik}) — ${why}`) },
    { path: "corporate.sec.registrant", value: name, confidence, sourceUrl, quote: quote(name) },
    { path: "corporate.sec.filings_matched", value: total, confidence: 1, sourceUrl },
  ];

  if (byCik.size === 1) {
    const [[cik, name]] = [...byCik];
    return emit(cik, name, 0.9, `the only filer whose annual report contains ${domain}`);
  }

  const brand = BRAND(domain);
  const named = [...byCik].filter(([, name]) => brand.length >= 4 && normName(name).includes(brand));
  if (named.length === 1) {
    const [cik, name] = named[0];
    return emit(cik, name, 0.85, `named after ${domain}, among ${byCik.size} filers mentioning it`);
  }

  /*
   * Ambiguous. Emitting the most-likely answer here is exactly how a wrong
   * legal identity gets published, so it emits a LEAD instead: visible,
   * low-confidence, and carrying no CIK for the concept adapters to use.
   */
  return [
    { path: "corporate.sec.filer", value: true, confidence: 1, sourceUrl },
    {
      path: "corporate.sec.candidates",
      value: [...byCik.values()].slice(0, 5).join(" | "),
      confidence: 0.4,
      sourceUrl,
      quote: quote(`${byCik.size} filers mention ${domain}; none is uniquely identifiable as its registrant`),
    },
  ];
}

const ftsUrl = (domain: string) =>
  `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(domain)}%22&forms=10-K`;

export const secIdentity: Adapter = {
  kind: "corporate.sec",
  module: "14. Corporate",
  label: "SEC EDGAR full-text search",
  cadence: "monthly",
  tier: "A",
  format: "json",
  // Public-company status does not change often, and this is the gate for
  // every financial adapter, so it is cheap to be generous with the timeout.
  url: (c) => ftsUrl(c.domain),
  rate: { rpm: 30, minIntervalMs: 120 },
  timeoutMs: 15_000,
  extract: (body, ctx) => resolveCik(body, ctx.company.domain),
};

// ---------------------------------------------------------------------------
// XBRL concepts
// ---------------------------------------------------------------------------

type ConceptRow = {
  start?: string; end?: string; val?: number; form?: string;
  fp?: string; filed?: string; fy?: number; frame?: string;
};

const months = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));

/**
 * The latest ANNUAL figures for one concept, newest last.
 *
 * Three filters, each one load-bearing:
 *
 *  - `fp === "FY"` is not enough. A 10-Q carries FY-to-date rows, so the span
 *    must also be a year — without the 10-month floor a quarter is read as a
 *    full year and revenue appears to collapse.
 *  - `fy` is unusable as the period key. Apple's 2026 10-K reports FY2024,
 *    FY2025 and FY2026 and stamps `fy: 2026` on all three, so grouping by it
 *    silently keeps whichever row happened to be last.
 *  - the same period is restated across filings, so the newest `filed` wins.
 *    That is what makes the figure "as most recently reported".
 */
export function annualSeries(rows: readonly ConceptRow[]): Required<Pick<ConceptRow, "end" | "val" | "filed" | "form">>[] {
  const byPeriod = new Map<string, ConceptRow>();
  for (const r of rows) {
    if (!r.end || !r.start || !r.filed || typeof r.val !== "number") continue;
    if (r.fp !== "FY") continue;
    if (!/^(10-K|20-F|40-F)/.test(r.form ?? "")) continue;
    if (months(r.end) - months(r.start) < 10) continue;
    const prev = byPeriod.get(r.end);
    if (!prev || (prev.filed ?? "") < r.filed) byPeriod.set(r.end, r);
  }
  return [...byPeriod.values()]
    .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""))
    .map((r) => ({ end: r.end!, val: r.val!, filed: r.filed!, form: r.form! }));
}

function conceptFacts(body: unknown, path: string, sourceUrl: string): Fact[] {
  const d = asObj<{ entityName?: string; units?: Record<string, ConceptRow[]> }>(body);
  const units = d.units ?? {};
  // Nearly always USD. A foreign private issuer may report in its own
  // currency, and claiming USD for it would be a fabricated number.
  const unit = Object.keys(units).find((u) => Array.isArray(units[u]) && units[u].length > 0);
  if (!unit) return [];

  const series = annualSeries(units[unit]);
  if (series.length === 0) return [];

  const latest = series[series.length - 1];
  const prior = series.length > 1 ? series[series.length - 2] : null;

  const facts: Fact[] = [
    {
      path,
      value: latest.val,
      confidence: 1,
      sourceUrl,
      quote: quote(
        `${unit} ${latest.val.toLocaleString("en-US")} for the year ending ${latest.end}, ` +
          `as reported in a ${latest.form} filed ${latest.filed}`,
      ),
    },
    { path: `${path}.unit`, value: unit, confidence: 1, sourceUrl },
    { path: `${path}.period_end`, value: latest.end, confidence: 1, sourceUrl },
    { path: `${path}.filed`, value: latest.filed, confidence: 1, sourceUrl },
    { path: `${path}.form`, value: latest.form, confidence: 1, sourceUrl },
    { path: `${path}.periods_available`, value: series.length, confidence: 1, sourceUrl },
  ];

  /*
   * Growth is derived, not reported, so it is only emitted when both periods
   * come from filings and the earlier one is non-zero. A percentage against a
   * zero or negative base is arithmetic noise dressed as a trend.
   */
  if (prior && prior.val > 0) {
    const pct = ((latest.val - prior.val) / prior.val) * 100;
    facts.push({
      path: `${path}.yoy_pct`,
      value: Math.round(pct * 10) / 10,
      confidence: 1,
      sourceUrl,
      quote: quote(
        `${unit} ${prior.val.toLocaleString("en-US")} (year ending ${prior.end}) ` +
          `to ${latest.val.toLocaleString("en-US")} (year ending ${latest.end})`,
      ),
    });
  }

  return facts;
}

const concept = (opts: { kind: string; label: string; path: string; tag: string }): Adapter => ({
  kind: opts.kind,
  module: "15. Financial",
  label: opts.label,
  cadence: "monthly",
  tier: "A",
  format: "json",
  // Gated on a CIK that `corporate.sec` resolved soundly. No CIK means not a
  // US filer, or an identity we refused to guess — either way, no figures.
  url: (c: Company) =>
    c.cik ? `https://data.sec.gov/api/xbrl/companyconcept/CIK${c.cik}/us-gaap/${opts.tag}.json` : null,
  rate: { rpm: 60, minIntervalMs: 110 },
  timeoutMs: 15_000,
  maxBytes: 4_000_000,
  extract: (body, ctx) => conceptFacts(body, opts.path, ctx.url),
});

/**
 * Five concepts, chosen to answer "healthy, growing or contracting" and
 * nothing more. Revenue uses the ASC 606 tag rather than the legacy
 * `Revenues`: it is what current filers use, and adding a fallback tag would
 * put a second "we could not read this" row on every company that reports
 * under only one of them.
 */
export const FINANCIAL_ADAPTERS: Adapter[] = [
  /*
   * TWO revenue tags, because one is not enough and the failure is silent.
   *
   * NVIDIA stopped filing the ASC 606 tag after FY2022 and moved to
   * `Revenues`. Reading only the first gave a 2022 revenue figure sitting
   * beside a 2026 net income — $120B of profit on $26.9B of revenue, which is
   * not a number that exists. Nothing errored; the revenue line simply froze
   * four years ago while every other line moved on.
   *
   * Both are collected and `financialsOf` prefers whichever reports the LATER
   * period, so a filer that switches tags keeps a continuous revenue line.
   */
  concept({ kind: "financial.revenue", label: "SEC XBRL — revenue (ASC 606)", path: "financial.revenue", tag: "RevenueFromContractWithCustomerExcludingAssessedTax" }),
  concept({ kind: "financial.revenue_alt", label: "SEC XBRL — revenue (total)", path: "financial.revenue_alt", tag: "Revenues" }),
  concept({ kind: "financial.net_income", label: "SEC XBRL — net income", path: "financial.net_income", tag: "NetIncomeLoss" }),
  concept({ kind: "financial.assets", label: "SEC XBRL — total assets", path: "financial.assets", tag: "Assets" }),
  concept({ kind: "financial.cash", label: "SEC XBRL — cash and equivalents", path: "financial.cash", tag: "CashAndCashEquivalentsAtCarryingValue" }),
  concept({ kind: "financial.equity", label: "SEC XBRL — stockholders' equity", path: "financial.equity", tag: "StockholdersEquity" }),
];

export const SEC_ADAPTERS: Adapter[] = [secIdentity, ...FINANCIAL_ADAPTERS];
