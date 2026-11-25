/**
 * The data behind the public, unauthenticated /c/[domain] page.
 *
 * This page is the free tier AND the acquisition engine, so it has two
 * constraints the authenticated API does not:
 *
 *  1. SECURITY. It fetches a domain taken straight from the URL, which is a
 *     textbook SSRF vector — `/c/169.254.169.254` would hit cloud metadata,
 *     `/c/localhost` would hit our own services. `publicDomain()` below is the
 *     guard, and it fails closed.
 *  2. SPEED. A full dossier took 18s live. A page cannot do that, so this runs
 *     a curated FAST subset with bounded concurrency and a hard deadline, and
 *     renders whatever came back. Partial beats slow.
 *
 * Free-tier shape, per the pricing decision: give away the PRESENT, charge for
 * the PAST. So this returns current state only. History is the paid product.
 */

import { publicDomain } from "./domain";
import { adaptersFor, byKind } from "./sources/registry";
import { runAdapter } from "./sources/run";
import type { Company, Fact } from "./sources/types";

/**
 * The curated fast set. Chosen on MEASURED latency, and biased toward facts a
 * stranger finds immediately impressive — the DNS vendor stack most of all.
 */
export const PUBLIC_KINDS = [
  "stack.dns",          // ~174ms, and the single best "how did you know that" fact
  "identity.mail",      // DNS
  "identity.dmarc",     // DNS
  "identity.schema",    // 1 req: name, type, statutory footer
  "pricing",            // 1 req: the headline
  "llmstxt",            // 1 req
  "identity.apps",      // 1 req: unlocks app reviews later
  "history.wayback",    // 1 req: domain age
  "sitemap",            // 1 req: scale and sections
  "identity.ai_stance", // 1 req (robots.txt)
  /*
   * Handle discovery. One homepage read, and it is what makes phase two
   * possible at all: without it no npm package and no GitHub org is ever
   * resolved, so every handle-gated adapter stayed silent and the security
   * module produced nothing for any company.
   */
  "discover",
  // The job board is linked from /careers, not the homepage.
  "discover.careers",
  // Decides whether this company files with the SEC at all. One request, and
  // it is the gate for every figure in PHASE2_KINDS.
  "corporate.sec",
] as const;

/**
 * Phase two: adapters that cannot run until phase one has resolved an identity.
 *
 * The dossier used to be a single flat pass with `{ domain }` as the whole
 * company, which meant every adapter keyed on a HANDLE — a CIK, an npm name,
 * an app id — returned null from `url()` and was skipped without a trace. The
 * catalog looked twice as capable as the page actually was.
 *
 * These only run when phase one produced the handle they need, so a private
 * company costs nothing here: no CIK, no requests, no empty section.
 */
export const PHASE2_KINDS = [
  // Resolves the legal entity from a company name, which the insolvency
  // register then needs. A chain, which is why passes are a loop.
  "corporate.gleif",
  "jobs",
  "legal.insolvency",
  "security.advisories.package",
  "security.advisories.repo",
  "financial.revenue",
  "financial.revenue_alt",
  "financial.net_income",
  "financial.assets",
  "financial.cash",
  "financial.equity",
  /*
   * Eighteen adapters that were already written and had never run.
   *
   * Every one is handle-gated, and nothing promoted a handle until the
   * resolution loop existed — so the catalogue advertised GitHub activity,
   * npm adoption, status-page history and store ratings while the page showed
   * none of it. Listing them here is free: the loop only fires an adapter
   * whose `url()` resolves, so a company with no status page pays nothing for
   * the status adapters.
   */
  "github.org",
  "github.events",
  "github.repo",
  "github.license",
  "github.languages",
  "github.activity",
  "github.releases",
  "github.contributors",
  "github.sbom",
  "github.issues",
  "repo.ecosystems",
  "security.scorecard",
  "reliability.status",
  "reliability.incidents",
  "adoption.npm",
  "reviews.appstore",
  "reviews.wordpress",
  "attention.wikipedia",
] as const;

/**
 * Promote phase-one facts into handles phase two can key on.
 *
 * Deliberately narrow: a handle is only adopted from a fact we were willing to
 * publish as sound. `corporate.sec.candidates` is the refusal case and carries
 * no CIK, so an ambiguous registrant yields no financials rather than the
 * financials of whichever company happened to sort first.
 */
export function handlesFrom(domain: string, facts: readonly Fact[]): Company {
  const c: Company = { domain };
  const cik = facts.find((f) => f.path === "corporate.sec.cik");
  if (cik && typeof cik.value === "string" && /^\d{10}$/.test(cik.value)) c.cik = cik.value;

  /*
   * Handles scraped off the homepage, adopted only at full confidence.
   *
   * Discovery marks a single candidate 0.9 and several candidates 0.6, because
   * several links means it guessed. A guessed npm package would attach another
   * project's vulnerabilities to this company, so only the unambiguous case is
   * promoted and the rest stay as discovery facts a human can read.
   */
  const sole = (path: string): string | null => {
    const f = facts.find((x) => x.path === path);
    if (!f || typeof f.value !== "string") return null;
    if ((f.confidence ?? 0) < 0.9) return null;
    const first = f.value.split(",")[0]?.trim();
    return first && !first.includes(",") ? first : null;
  };

  /*
   * The job board. Phase 0 found the token equals the company name 6 times in
   * 7, but a guess is still a guess — this adopts only what discovery actually
   * read off the homepage, and only when it found one candidate.
   */
  for (const provider of ["greenhouse", "lever", "ashby"] as const) {
    const token = sole(`discovered.ats_${provider}`);
    if (token) {
      c.ats = { provider, token };
      break;
    }
  }

  /*
   * A company NAME, for the registry lookup that resolves the legal entity.
   *
   * schema.org's `legalName` is preferred over a trading name because the
   * registry is keyed on registered names. Either way GLEIF applies its own
   * corroboration and refuses an ambiguous match, so a rough name here cannot
   * become a wrong identity downstream.
   */
  const named =
    facts.find((f) => f.path === "corporate.legal_name") ??
    facts.find((f) => f.path === "corporate.trading_name");
  if (named && typeof named.value === "string" && named.value.trim().length >= 4) {
    c.name = named.value.trim();
  }

  /*
   * The registered legal name, promoted ONLY when the registry match was
   * corroborated.
   *
   * `corporate.legal_name` is written by the GLEIF resolver at confidence 1
   * when it resolved soundly, and the ambiguous case writes
   * `corporate.gleif.candidate_name` instead — which is deliberately not read
   * here. A legal source answering about the wrong entity would report another
   * company's insolvency, so a candidate is not good enough.
   */
  const legal = facts.find((f) => f.path === "corporate.legal_name");
  if (legal && typeof legal.value === "string" && (legal.confidence ?? 0) >= 0.9) {
    c.legalName = legal.value;
  }

  // The status page, which unlocks incident history and MTTR. Discovery
  // already rejects a status host on someone else's domain.
  const status = sole("discovered.status_host");
  if (status) c.statusHost = status;

  const npm = sole("discovered.npm_org");
  if (npm) c.npm = npm;
  const org = sole("discovered.github_org");
  if (org) c.githubOrg = org;

  return c;
}

/** Bounded-concurrency map. Replaces the pooled() helper deleted with /api/research. */
async function pooled<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type PublicDossier = {
  domain: string;
  /** Grouped by the adapter's dossier module, for rendering. */
  groups: { module: string; facts: Fact[] }[];
  factCount: number;
  sources: { label: string; kind: string }[];
  /** Sources we tried and could not read — stated, never hidden. */
  unavailable: { label: string; reason: string }[];
  ms: number;
  /** Best guess at a display name, from the facts themselves. */
  title: string | null;
  companyType: string | null;
};

const DEADLINE_MS = 12_000;

/**
 * Build the public dossier.
 *
 * NOT cached here on purpose — the caller wraps this in a `use cache` scope so
 * the cache key is the domain argument alone. Caching inside would hide the
 * key from Next and make per-domain revalidation impossible.
 */
export async function buildPublicDossier(domain: string): Promise<PublicDossier> {
  const t0 = Date.now();
  const company: Company = { domain };
  /*
   * The CIK resolver runs FIRST, not merely early.
   *
   * The pool is six wide. This adapter sat mid-list, so on a site with
   * several slow sources all six slots stayed busy until the 12s deadline and
   * the resolver never started at all — which then read as "we cannot say
   * whether this company files" for companies that plainly do. It costs one
   * request and gates every figure in phase two, so it gets a slot at t=0.
   */
  const applicable = adaptersFor(company)
    .filter((a) => (PUBLIC_KINDS as readonly string[]).includes(a.kind))
    .sort((a, b) => Number(b.kind === "corporate.sec") - Number(a.kind === "corporate.sec"));

  // A deadline, not a timeout per request: the page must paint even if a
  // third-party source is having a bad day.
  const deadline = AbortSignal.timeout(DEADLINE_MS);

  const run1 = await pooled(applicable, 6, async (a) => {
    try {
      return { a, r: await runAdapter(a, company, { signal: deadline }) };
    } catch {
      return { a, r: null };
    }
  });

  /*
   * Resolution passes, until nothing new unlocks.
   *
   * This was two fixed phases and that was not enough, because dependencies
   * are deeper than two: a homepage yields a company NAME, the name resolves a
   * legal ENTITY in GLEIF, and only a registered entity can be queried against
   * the insolvency register. With two phases the last step could never run, and
   * the symptom was not an error — the section simply never appeared, which is
   * the same silent failure that hid every handle-gated adapter before.
   *
   * So each pass re-derives handles from everything learned so far and runs
   * whatever that unlocks. An adapter runs at most once. The bound is a hard
   * stop, not a guess: three passes covers the longest real chain
   * (domain -> name -> entity -> register) and a cycle cannot run away.
   */
  const MAX_PASSES = 3;
  const laterRuns: typeof run1 = [];
  const done = new Set(applicable.map((a) => a.kind));
  let known = run1.flatMap(({ r }) => (r && r.status === "ok" ? r.facts : []));

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const resolved = handlesFrom(domain, known);
    const next = (PHASE2_KINDS as readonly string[])
      .filter((k) => !done.has(k))
      .map((k) => byKind(k))
      .filter((a): a is NonNullable<typeof a> => !!a && a.url(resolved) !== null);

    if (next.length === 0) break;
    for (const a of next) done.add(a.kind);

    const batch = await pooled(next, 5, async (a) => {
      try {
        return { a, r: await runAdapter(a, resolved, { signal: deadline }) };
      } catch {
        return { a, r: null };
      }
    });

    laterRuns.push(...batch);
    known = [...known, ...batch.flatMap(({ r }) => (r && r.status === "ok" ? r.facts : []))];
  }

  const runs = [...run1, ...laterRuns];

  const byModule = new Map<string, Fact[]>();
  const sources: PublicDossier["sources"] = [];
  const unavailable: PublicDossier["unavailable"] = [];

  for (const { a, r } of runs) {
    if (!r || r.status === "skip") continue;
    if (r.status === "fail") {
      unavailable.push({ label: a.label, reason: r.reason });
      continue;
    }
    if (r.status !== "ok" || !r.facts.length) continue;
    sources.push({ label: a.label, kind: a.kind });
    const list = byModule.get(a.module) ?? [];
    list.push(...r.facts);
    byModule.set(a.module, list);
  }

  const all = [...byModule.values()].flat();
  const pick = (path: string) => all.find((f) => f.path === path)?.value;

  return {
    domain,
    // Module keys are prefixed with their number ("1. Positioning"), so a
    // lexical sort gives the intended reading order.
    groups: [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([module, facts]) => ({ module, facts })),
    factCount: all.length,
    sources,
    unavailable,
    ms: Date.now() - t0,
    title: typeof pick("positioning.title") === "string" ? String(pick("positioning.title")) : null,
    companyType: typeof pick("identity.company_type") === "string" ? String(pick("identity.company_type")) : null,
  };
}

/** Human label for a fact path, so the page is readable without a schema. */
export function factLabel(path: string): string {
  const LABELS: Record<string, string> = {
    "positioning.title": "Page title",
    "positioning.h1": "Headline",
    "identity.company_type": "Company type",
    "identity.schema_type": "schema.org type",
    "corporate.legal_name": "Legal name",
    "corporate.trading_name": "Trading name",
    "corporate.company_number": "Company number",
    "corporate.vat_id": "VAT ID",
    "ecosystem.integrations.count": "Published integrations",
    "ecosystem.integrations.sample": "Integrations (sample)",
    "hiring.newest_posting": "Most recent job posting",
    "hiring.momentum_ratio": "Hiring momentum vs prior months",
    "market.competitors.named_count": "Competitors they name themselves",
    "market.competitors.named": "Named competitors",
    "legal.insolvency.notices": "Insolvency notices naming them",
    "legal.insolvency.latest_notice": "Most recent insolvency notice",
    "hiring.focus": "Hiring concentrated in",
    "hiring.function.engineering": "Open engineering roles",
    "hiring.function.product": "Open product roles",
    "hiring.function.marketing": "Open marketing roles",
    "hiring.function.sales": "Open sales roles",
    "hiring.function.operations": "Open operations roles",
    "hiring.function.finance": "Open finance roles",
    "hiring.function.leadership": "Open leadership roles",
    "hiring.function.other": "Roles we could not classify",
    "hiring.seniority.leadership": "Leadership-level postings",
    "hiring.seniority.staff": "Staff or principal postings",
    "hiring.seniority.senior": "Senior postings",
    "hiring.seniority.entry": "Entry-level postings",
    "hiring.remote_roles": "Postings naming remote",
    "security.advisories.subject": "Advisories are about",
    "security.advisories.count": "Advisories against their package",
    "security.advisories.critical": "Critical advisories",
    "security.advisories.high": "High-severity advisories",
    "security.advisories.medium": "Medium-severity advisories",
    "security.advisories.low": "Low-severity advisories",
    "security.advisories.worst_severity": "Worst advisory severity",
    "security.advisories.max_cvss": "Highest CVSS score",
    "security.advisories.latest": "Most recent advisory",
    "security.advisories.cves": "CVE identifiers",
    "security.disclosures.subject": "Disclosures are about",
    "security.disclosures.count": "Advisories they published themselves",
    "security.disclosures.latest": "Most recent self-disclosure",
    "security.disclosures.worst_severity": "Worst severity disclosed",
    "corporate.sec.cik": "SEC filer (CIK)",
    "corporate.sec.registrant": "SEC registrant name",
    "corporate.sec.filings_matched": "Annual reports naming this domain",
    "corporate.sec.candidates": "Possible SEC registrants (unresolved)",
    // Every financial label says "reported", because that is the only kind of
    // financial number in this product. Nothing here is estimated or modelled.
    "financial.revenue": "Revenue (reported)",
    "financial.revenue.yoy_pct": "Revenue growth, year over year",
    "financial.revenue.period_end": "Revenue period ended",
    "financial.revenue.form": "Revenue reported on form",
    "financial.revenue.filed": "Revenue filing date",
    "financial.revenue.unit": "Revenue currency",
    "financial.revenue.periods_available": "Annual revenue periods on file",
    "financial.revenue_alt": "Revenue, total (reported)",
    "financial.revenue_alt.yoy_pct": "Revenue growth, year over year",
    "financial.revenue_alt.period_end": "Revenue period ended",
    "financial.net_income": "Net income (reported)",
    "financial.net_income.yoy_pct": "Net income change, year over year",
    "financial.assets": "Total assets (reported)",
    "financial.assets.yoy_pct": "Total assets change, year over year",
    "financial.cash": "Cash and equivalents (reported)",
    "financial.cash.yoy_pct": "Cash change, year over year",
    "financial.equity": "Shareholders' equity (reported)",
    "financial.equity.yoy_pct": "Equity change, year over year",
    "geo.registered_office": "Registered office",
    "geo.place_of_registration": "Place of registration",
    "contact.telephone": "Telephone",
    "contact.email": "Contact email",
    "stack.vendors.count": "Vendors detected",
    "stack.vendors.list": "Vendor stack",
    "stack.email_provider": "Email provider",
    "stack.mx_hosts": "Mail hosts",
    "security.dmarc_policy": "DMARC policy",
    "security.dmarc_enforced": "DMARC enforced",
    "pricing.visible": "Pricing published",
    "pricing.tiers.count": "Pricing tiers",
    "pricing.tiers.names": "Tier names",
    "pricing.currency_observed": "Currency shown to us",
    "pricing.extraction_source": "How we read the prices",
    "product.llmstxt.present": "Publishes llms.txt",
    "product.llmstxt.sections": "llms.txt sections",
    "product.llmstxt.bytes": "llms.txt size (bytes)",
    "product.llmstxt.links": "llms.txt links",
    "product.changelog.present": "Publishes a changelog",
    "product.changelog.latest_date": "Latest changelog entry",
    "product.api.endpoints": "Public API endpoints",
    "pricing.amounts.count": "Prices on the page",
    "pricing.has_free": "Has a free tier",
    "pricing.has_custom": "Has a contact-sales tier",
    "pricing.has_enterprise": "Has an Enterprise tier",
    "pricing.lines.count": "Product lines priced",
    "signals.subdomains.count": "Subdomains seen in certificates",
    "signals.subdomains.list": "Subdomains",
    "identity.impressum_present": "Publishes an Impressum",
    "identity.contact_page": "Has a contact page",
    "attention.tranco.rank": "Tranco popularity rank",
    "geo.locales": "Locales published",
    "discovered.has_ios_app": "Has an iOS app",
    "discovered.ios_bundle_ids": "iOS bundle IDs",
    "history.first_archived": "First archived",
    "history.domain_age_years": "Domain age (years)",
    "site.sitemap.urls": "Pages in sitemap",
    "site.sections": "Site sections",
    "site.sections.count": "Section count",
    "site.ai_crawlers_blocked": "AI crawlers blocked",
    "site.ai_crawlers_blocked_list": "Which AI crawlers",
  };
  if (LABELS[path]) return LABELS[path];
  if (path.startsWith("stack.vendor.")) return `Uses ${path.slice("stack.vendor.".length).replace(/-/g, " ")}`;
  // Fall back to the last two dotted segments, humanised.
  return path.split(".").slice(-2).join(" ").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Hide the machinery from a stranger: fingerprints and raw lists are noise. */
export function isPublicFact(f: Fact): boolean {
  // An empty value renders as a blank row with a label and no answer, which
  // reads as a bug. "AI crawlers blocked: 0" is the useful fact; the empty
  // list beside it is not.
  if (f.value === "" || f.value === null || f.value === undefined) return false;
  const machinery = /\.fingerprint$|\.outline$|\.summary$|_minor$|\.mx_hosts$|\.list$/.test(f.path);
  if (!machinery) return true;
  return f.path === "stack.vendors.list" || f.path === "site.ai_crawlers_blocked_list";
}

export { byKind };
// Re-exported so existing imports keep working after the extraction.
export { publicDomain };
