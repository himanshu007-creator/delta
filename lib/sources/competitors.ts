/**
 * Competitors, named by the company itself.
 *
 * "Who competes with this company" is the question the whole product is for,
 * and until now the only answer came from a hand-curated seed list — so an
 * unknown domain had no competitors at all.
 *
 * The source is the company's own sitemap, which is already fetched: SaaS
 * companies publish comparison pages to capture "x vs y" search traffic, and
 * those URLs are a competitor list the company wrote about itself. That is
 * evidence, not inference. It costs zero extra requests.
 *
 * The naive version — "URL contains vs" — is wrong in three ways, all
 * observed live:
 *
 *   linear.app/integrations/vs-code            -> Visual Studio Code
 *   vercel.com/kb/guide/sql-vs-nosql-databases -> a generic explainer
 *   vercel.com/kb/guide/vercel-passport-vs-deployment-protection
 *                                              -> two of their OWN products
 *
 * So the rule is strict: the URL must contain `a-vs-b`, and one side must
 * equal the company's own brand EXACTLY. "vercel-passport" is not "vercel",
 * "vs-code" has no left-hand side, and "sql" is neither. What survives is the
 * other side, which is a company they chose to compare themselves against.
 */

import type { Fact } from "./types";
import { quote } from "./types";

/** Slugs that are never a competitor, even in a well-formed comparison. */
const NOT_A_COMPANY = new Set([
  "sql", "nosql", "rest", "graphql", "ssr", "csr", "ssg", "isr", "spa", "mpa",
  "http", "https", "tcp", "udp", "css", "js", "ts", "api", "apis", "cli", "gui",
  "saas", "paas", "iaas", "b2b", "b2c", "ai", "ml", "llm", "seo", "sem",
  "monolith", "microservices", "serverless", "containers", "kubernetes",
  "code", "codes", "others", "alternatives", "competitors", "comparison",
  "free", "paid", "open-source", "self-hosted", "cloud", "on-premise",
]);

const brandOf = (domain: string) => domain.replace(/^www\./, "").split(".")[0].toLowerCase();
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

/**
 * Competitor slugs this company names in its own comparison URLs.
 *
 * Exported for the test, which runs it over the real sitemaps that produced
 * each of the three false positives above.
 */
export function namedCompetitors(locs: readonly string[], domain: string): string[] {
  const brand = brandOf(domain);
  if (brand.length < 3) return [];

  const found = new Map<string, number>();

  for (const loc of locs) {
    // The last path segment is where a comparison slug lives.
    const slug = clean(decodeURIComponent(loc.split("?")[0].split("#")[0]).split("/").filter(Boolean).pop() ?? "");
    if (!slug) continue;

    /*
     * Split on every `-vs-`. A slug may contain several ("eve-vs-ai-sdk-
     * agents-vs-workflowagent"), and requiring an exact brand match on one
     * side is what rejects it — none of those parts is the brand.
     */
    const parts = slug.split("-vs-");
    if (parts.length < 2) continue;
    // A leading empty side means the slug STARTED with "vs-", as in "vs-code".
    if (parts.some((p) => p === "")) continue;
    if (!parts.includes(brand)) continue;

    for (const p of parts) {
      if (p === brand) continue;
      if (NOT_A_COMPANY.has(p)) continue;
      if (p.length < 2 || p.length > 40) continue;
      // Their own sub-brand, e.g. "vercel-passport" against "vercel".
      if (p.startsWith(`${brand}-`) || p.endsWith(`-${brand}`)) continue;
      found.set(p, (found.get(p) ?? 0) + 1);
    }
  }

  return [...found.keys()].sort();
}

/**
 * Facts for the competitor set.
 *
 * Names only — deliberately no domains. A slug is not a hostname: "copyai" is
 * copy.ai and "jasper" is jasper.ai, so appending .com would send a reader to
 * the wrong company while looking authoritative. The comparison page itself is
 * published as the evidence, and a human or an agent can follow it.
 */
export function competitorFacts(locs: readonly string[], domain: string, sourceUrl: string): Fact[] {
  const names = namedCompetitors(locs, domain);
  if (names.length === 0) return [];

  return [
    {
      path: "market.competitors.named_count",
      value: names.length,
      confidence: 1,
      sourceUrl,
      quote: quote(`${domain} publishes comparison pages against ${names.length} other companies`),
    },
    {
      path: "market.competitors.named",
      value: names.slice(0, 40).join(","),
      confidence: 1,
      sourceUrl,
      quote: quote(`Named by ${domain} in its own comparison URLs: ${names.slice(0, 8).join(", ")}`),
    },
  ];
}
