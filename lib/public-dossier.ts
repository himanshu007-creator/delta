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
] as const;

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
  const applicable = adaptersFor(company).filter((a) => (PUBLIC_KINDS as readonly string[]).includes(a.kind));

  // A deadline, not a timeout per request: the page must paint even if a
  // third-party source is having a bad day.
  const deadline = AbortSignal.timeout(DEADLINE_MS);

  const runs = await pooled(applicable, 6, async (a) => {
    try {
      return { a, r: await runAdapter(a, company, { signal: deadline }) };
    } catch {
      return { a, r: null };
    }
  });

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
