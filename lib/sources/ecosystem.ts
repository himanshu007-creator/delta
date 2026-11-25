/**
 * Ecosystem size and shape, from the sitemap already in hand.
 *
 * "Which of these two has the bigger integration catalogue, and what does the
 * other one not connect to" is a question buyers ask constantly and no free
 * tool answers. Integration directories are published as ordinary indexed
 * pages, so the sitemap we already fetch contains the whole catalogue — at
 * zero additional request cost.
 *
 * The discipline is the same as the competitor extractor: a URL under a path
 * segment called `integrations` is evidence; a URL merely containing the word
 * is not. These are rejected on purpose:
 *
 *   /blog/our-integrations-strategy     -> an article about integrations
 *   /integrations                       -> the index itself, not an entry
 *   /integrations/category/crm          -> a filter, not an integration
 */

import type { Fact } from "./types";
import { quote } from "./types";

/** Path segments that hold a catalogue of third-party connections. */
const DIRECTORY = /^(integrations?|apps|marketplace|plugins|extensions|connectors)$/i;

/**
 * Segments that are navigation rather than an entry.
 *
 * `category` and `tag` pages inflate a catalogue with filters; counting them
 * would make a site with a good taxonomy look like it has more partners.
 */
const NOT_AN_ENTRY = new Set([
  "category", "categories", "tag", "tags", "all", "browse", "search", "page",
  "index", "directory", "popular", "featured", "new", "list",
]);

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

/**
 * Integration slugs, deduplicated and sorted.
 *
 * Exported for the test, which runs it over the real URL shapes above.
 */
export function integrationSlugs(locs: readonly string[], domain: string): string[] {
  const own = domain.replace(/^www\./, "").split(".")[0].toLowerCase();
  const found = new Set<string>();

  for (const loc of locs) {
    let path: string;
    try {
      path = decodeURIComponent(loc.split("?")[0].split("#")[0]);
    } catch {
      continue;
    }
    const segs = path.replace(/^https?:\/\/[^/]+/i, "").split("/").filter(Boolean);

    // The directory segment must be an actual path segment, and there must be
    // something after it — the index page is not an integration.
    const at = segs.findIndex((x) => DIRECTORY.test(x));
    if (at === -1 || at === segs.length - 1) continue;

    // Exactly one segment after the directory. Deeper paths are sub-pages of
    // an entry ("/integrations/slack/setup"), already counted by their parent.
    const rest = segs.slice(at + 1);
    const slug = slugOf(rest[0]);
    if (!slug || NOT_AN_ENTRY.has(slug)) continue;
    if (slug.length < 2 || slug.length > 48) continue;
    // Their own brand is not a third-party integration.
    if (slug === own) continue;

    found.add(slug);
  }

  return [...found].sort();
}

export function ecosystemFacts(locs: readonly string[], domain: string, sourceUrl: string): Fact[] {
  const slugs = integrationSlugs(locs, domain);
  if (slugs.length === 0) return [];

  return [
    {
      path: "ecosystem.integrations.count",
      value: slugs.length,
      confidence: 0.9,
      sourceUrl,
      quote: quote(`${slugs.length} integration pages published under ${domain}`),
    },
    {
      /*
       * Bounded hard. A large marketplace runs to thousands of entries and an
       * unbounded fact value would dominate the row it is stored in.
       */
      path: "ecosystem.integrations.sample",
      value: slugs.slice(0, 60).join(","),
      confidence: 0.9,
      sourceUrl,
      quote: quote(`e.g. ${slugs.slice(0, 8).join(", ")}`),
    },
  ];
}
