/**
 * The search index behind the landing page's search box.
 *
 * Built from the same two sources the pages themselves are built from, so a
 * result can never point at a page that does not exist — which is the usual
 * way a hand-maintained search index rots.
 *
 * ponytail: a plain array, filtered with `includes`. 263 entries is far too
 * few to justify a search library or an index format; Fuse.js would ship 20kB
 * to rank a list that fits in a single cache line of thought.
 */

import { SEED } from "./seed";
import generatedVendors from "./stack-vendors.generated.json";
import { prettyVendor } from "./stack-index";

export type Hit = {
  /** Lowercased haystack. Precomputed, because the filter runs per keystroke. */
  q: string;
  label: string;
  href: string;
  kind: "company" | "vendor";
  /** Shown to the right of the label. */
  note: string;
};

const COMPANIES: Hit[] = SEED.map((c) => ({
  q: `${c.name} ${c.domain} ${c.category}`.toLowerCase(),
  label: c.name,
  href: `/c/${c.domain}`,
  kind: "company",
  note: c.domain,
}));

const VENDORS: Hit[] = (generatedVendors as string[]).map((slug) => ({
  q: `${prettyVendor(slug)} ${slug}`.toLowerCase(),
  label: prettyVendor(slug),
  href: `/stack/${slug}`,
  kind: "vendor",
  note: "who uses it",
}));

export const SEARCH_INDEX: readonly Hit[] = [...COMPANIES, ...VENDORS];

/**
 * Rank: a prefix match beats a word-boundary match beats a substring match.
 *
 * Without the word-boundary rung, typing "slack" ranks "Amazon SES" above
 * "Slack" on any index where a substring happens to appear earlier.
 */
export function searchHits(query: string, limit = 8): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const scored: Array<{ hit: Hit; score: number }> = [];
  for (const hit of SEARCH_INDEX) {
    const at = hit.q.indexOf(q);
    if (at === -1) continue;
    const score = at === 0 ? 0 : hit.q[at - 1] === " " ? 1 : 2;
    scored.push({ hit, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.hit.label.length - b.hit.label.length)
    .slice(0, limit)
    .map((s) => s.hit);
}
