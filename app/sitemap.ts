import type { MetadataRoute } from "next";
import { comparablePairs, SEED } from "@/lib/seed";
import { abs } from "@/lib/site";
import { isPageworthyVendor, stackIndex } from "@/lib/stack-index";

/**
 * Every page we actually want indexed.
 *
 * Company pages are included only for the SEED set: /c/[domain] accepts any
 * valid domain, but listing an unbounded space would be spam. The seed
 * companies are ones we have really indexed and can show real facts for.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const ix = stackIndex();
  const generated = new Date(ix.generatedAt);

  const core: MetadataRoute.Sitemap = [
    { url: abs("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: abs("/stack"), lastModified: generated, changeFrequency: "weekly", priority: 0.9 },
    { url: abs("/compare"), lastModified: generated, changeFrequency: "weekly", priority: 0.9 },
    { url: abs("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: abs("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  const vendors: MetadataRoute.Sitemap = ix.vendors
    .filter((v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor))
    .map((v) => ({
      url: abs(`/stack/${v.vendor}`),
      lastModified: generated,
      changeFrequency: "weekly" as const,
      // A vendor used by many companies is a more useful page than a long-tail one.
      priority: v.domains.length >= 20 ? 0.8 : 0.6,
    }));

  const companies: MetadataRoute.Sitemap = SEED.map((s) => ({
    url: abs(`/c/${s.domain}`),
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  const comparisons: MetadataRoute.Sitemap = comparablePairs().map((p) => ({
    url: abs(`/compare/${p.slug}`),
    lastModified: generated,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...core, ...vendors, ...companies, ...comparisons];
}
