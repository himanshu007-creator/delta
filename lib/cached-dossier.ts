/**
 * The one cached entry point for a company's public dossier.
 *
 * Shared by /c/[domain] and /compare/[a]-vs-[b] on purpose: both read the same
 * cache key, so a comparison page reuses whatever the company pages already
 * warmed, and a popular company is crawled once rather than once per page type.
 *
 * `cacheLife("hours")` because these facts move on a 12h crawl cadence at most,
 * re-crawling per visitor would be rude to the sources, and anything under five
 * minutes makes the page non-prerenderable under Cache Components.
 */

import { cacheLife, cacheTag } from "next/cache";
import { buildPublicDossier, type PublicDossier } from "./public-dossier";

export async function cachedDossier(domain: string): Promise<PublicDossier> {
  "use cache";
  cacheLife("hours");
  cacheTag(`company:${domain}`);
  return buildPublicDossier(domain);
}

/** One fact by path, or null. The comparison pages ask this a lot. */
export function factValue(d: PublicDossier, path: string): string | number | boolean | null {
  for (const g of d.groups) {
    const f = g.facts.find((x) => x.path === path);
    if (f) return f.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Store-first reads
// ---------------------------------------------------------------------------

import { companyFacts, storeConfigured } from "./store";

export type FactMap = Map<string, { value: string | null; sourceUrl: string | null; quote: string | null; confidence: number | null }>;

/**
 * Facts for a company, preferring the STORE over a live crawl.
 *
 * Once a crawl window has run, this is a single indexed query instead of ~25
 * HTTP requests — which is the difference between a page that can be rendered
 * on demand and one that cannot. The live crawl remains as a fallback for a
 * company nobody has crawled yet, so a cold domain still produces something.
 *
 * Returns a Map rather than the grouped PublicDossier shape because every
 * caller here looks facts up by path.
 */
export async function factsFor(domain: string): Promise<{ facts: FactMap; source: "store" | "live"; count: number }> {
  if (storeConfigured()) {
    const res = await companyFacts(domain);
    if (res.ok && res.data && res.data.length > 0) {
      const facts: FactMap = new Map();
      for (const f of res.data) {
        facts.set(f.path, {
          value: f.value, sourceUrl: f.source_url, quote: f.quote, confidence: f.confidence,
        });
      }
      return { facts, source: "store", count: facts.size };
    }
  }

  // Nothing stored yet: crawl it, through the same cache /c/[domain] uses.
  const d = await cachedDossier(domain);
  const facts: FactMap = new Map();
  for (const g of d.groups) {
    for (const f of g.facts) {
      facts.set(f.path, {
        value: f.value === null || f.value === undefined ? null : String(f.value),
        sourceUrl: f.sourceUrl ?? null,
        quote: f.quote ?? null,
        confidence: f.confidence ?? null,
      });
    }
  }
  return { facts, source: "live", count: facts.size };
}
