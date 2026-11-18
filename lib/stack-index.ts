/**
 * The inverted vendor index: vendor -> companies that use it.
 *
 * /c/[domain] answers "what does this company use". This answers the far more
 * commercially interesting inverse, "who uses Anthropic" — which is the page
 * type BuiltWith draws enormous organic traffic from, except our data sees
 * BACK-OFFICE purchases (Rippling, Wiz, Carta, LaunchDarkly) that frontend
 * script detection cannot.
 *
 * Built from DNS TXT alone, on purpose:
 *   - it is the fastest adapter measured (~174ms) and needs only a domain, so
 *     a whole seed set can be indexed inside one page render;
 *   - it is the only source that reveals purchases rather than page scripts.
 *
 * Until the store is wired, the index is computed from the seed set below and
 * cached for a day by the caller. Once `companies` is persisted this function
 * reads from it instead, and nothing else about the pages changes.
 *
 * HONESTY: a verification TXT record proves a RELATIONSHIP EXISTED, not current
 * paid use. A company may have trialled a tool and left the record behind. The
 * pages say so, and the facts carry confidence 0.9 for this reason.
 */

import { SEED, SEED_DOMAINS } from "./seed";
import { byKind } from "./sources/registry";
import { runAdapter } from "./sources/run";

/**
 * Seed set — recognisable companies across SaaS, retail, finance and industry,
 * so a vendor page has real content rather than three examples. Deliberately
 * broad rather than tech-only: the point is that this works for any company.
 */
export type StackEntry = { domain: string; vendors: string[] };
export type VendorRow = { vendor: string; domains: string[] };

async function pooled<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Read the vendor list for one domain. Never throws. */
async function vendorsFor(domain: string, signal?: AbortSignal): Promise<StackEntry> {
  const adapter = byKind("stack.dns");
  if (!adapter) return { domain, vendors: [] };
  const r = await runAdapter(adapter, { domain }, { signal }).catch(() => null);
  if (!r || r.status !== "ok") return { domain, vendors: [] };
  const list = r.facts.find((f) => f.path === "stack.vendors.list")?.value;
  return {
    domain,
    vendors: typeof list === "string" ? list.split(",").map((v) => v.trim()).filter(Boolean) : [],
  };
}

export type StackIndex = {
  byVendor: VendorRow[];
  entries: StackEntry[];
  domainsIndexed: number;
  ms: number;
};

/**
 * Build the whole index. The caller wraps this in a `use cache` scope so one
 * crawl serves every vendor page — otherwise each page view would re-resolve
 * the entire seed set.
 */
export async function buildStackIndex(signal?: AbortSignal): Promise<StackIndex> {
  const t0 = Date.now();
  // Concurrency 8, not 24: MEASURED, 24 parallel TXT lookups took 9.9s against
  // 94ms each when sequential — the resolver rate-limits under load, so piling
  // on makes it slower, not faster.
  const entries = (await pooled(SEED_DOMAINS, 8, (d) => vendorsFor(d, signal))).filter((e) => e.vendors.length);

  const map = new Map<string, string[]>();
  for (const e of entries) {
    for (const v of e.vendors) {
      const list = map.get(v) ?? [];
      if (!list.includes(e.domain)) list.push(e.domain);
      map.set(v, list);
    }
  }

  const byVendor = [...map.entries()]
    .map(([vendor, domains]) => ({ vendor, domains: domains.sort() }))
    // Most-used first: that is both the most useful ordering and the best
    // internal-linking shape for the pages that rank.
    .sort((a, b) => b.domains.length - a.domains.length || a.vendor.localeCompare(b.vendor));

  return { byVendor, entries, domainsIndexed: entries.length, ms: Date.now() - t0 };
}

/** Vendor slugs are produced by our own parser, so validation is strict. */
export function vendorSlug(input: string): string | null {
  if (!input || input.length > 48) return null;
  let v: string;
  try { v = decodeURIComponent(input).trim().toLowerCase(); } catch { return null; }
  if (!/^[a-z0-9][a-z0-9-]{1,46}$/.test(v)) return null;
  return v;
}

/** Vendors we will not build a page for, even if a record mentions them. */
const NOT_A_PRODUCT = new Set(["apple", "google", "facebook", "yahoo", "domain", "ms"]);
export const isPageworthyVendor = (v: string) => !NOT_A_PRODUCT.has(v);

/**
 * Slug to display label. Exported so the directory, the vendor page and the
 * search box cannot disagree about what a vendor is called.
 */
export const prettyVendor = (slug: string) =>
  slug
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

// ---------------------------------------------------------------------------
// The precomputed index, which is what the pages actually read
// ---------------------------------------------------------------------------

import generated from "./stack-index.generated.json" with { type: "json" };

export type GeneratedIndex = {
  generatedAt: string;
  domainsAttempted: number;
  domainsIndexed: number;
  vendors: VendorRow[];
  entries: StackEntry[];
};

/** Instant: a committed file, never a request-time crawl. */
export const stackIndex = (): GeneratedIndex => generated as GeneratedIndex;

export const vendorRow = (slug: string): VendorRow | null =>
  stackIndex().vendors.find((v) => v.vendor === slug) ?? null;

/** Other vendors used by the same companies — the internal-linking engine. */
export function relatedVendors(slug: string, limit = 12): VendorRow[] {
  const ix = stackIndex();
  const row = ix.vendors.find((v) => v.vendor === slug);
  if (!row) return [];
  const peers = new Set(row.domains);
  return ix.vendors
    .filter((v) => v.vendor !== slug && isPageworthyVendor(v.vendor))
    .map((v) => ({ row: v, overlap: v.domains.filter((d) => peers.has(d)).length }))
    .filter((x) => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap || b.row.domains.length - a.row.domains.length)
    .slice(0, limit)
    .map((x) => x.row);
}

// Re-exported so existing imports keep working after the extraction.
export { SEED, SEED_DOMAINS, seedFor, pairKey, parsePair, comparablePairs, type Category } from "./seed";
