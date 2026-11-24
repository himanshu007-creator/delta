/**
 * Our own /llms.txt — generated, not hand-written.
 *
 * Pleasingly self-consistent: one of our own adapters measures llms.txt
 * adoption across other companies (14 of 18 publish one), so publishing a real
 * one is both the convention and a demonstration.
 *
 * It is GENERATED from the live index so the numbers cannot drift from reality —
 * a stale hand-written file claiming the wrong vendor count would be exactly
 * the kind of unsourced assertion this product exists to avoid.
 */

import { comparablePairs, SEED } from "@/lib/seed";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { requestOrigin } from "@/lib/origin";
import { isPageworthyVendor, stackIndex } from "@/lib/stack-index";

/**
 * `export const dynamic = "force-static"` is rejected by Cache Components, as
 * are `runtime` and `dynamicParams`. The modern equivalent is a `use cache`
 * scope, which is all this needs — the body derives from a committed index and
 * never from the request.
 */
/**
 * The BODY is cached, not the Response.
 *
 * A `use cache` scope must return something serialisable, and a `Response` is a
 * class instance — returning one from inside the scope fails the build with
 * "Only plain objects... can be passed to Client Components". So cache the
 * string and construct the Response outside.
 */
/**
 * Built per request rather than cached, so the URLs inside name the host the
 * reader reached — a fork should advertise itself, not this deployment. The
 * body is a few kilobytes of text assembled from a committed index, and the
 * CDN still caches it per host via Cache-Control below.
 */
async function body(): Promise<string> {
  const origin = await requestOrigin();
  const abs = (path: string) => `${origin}${path}`;
  const ix = stackIndex();
  const vendors = ix.vendors.filter((v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor));
  const pairs = comparablePairs();
  const top = vendors.slice(0, 15);

  const text = `# ${SITE_NAME}

> ${SITE_TAGLINE}. ${SITE_DESCRIPTION}

${SITE_NAME} answers two questions about a company, from public records only, with every fact
linked to the page it came from:

1. **What is true now** — published pricing tiers, the vendors they buy, releases, hiring,
   security posture, legal entity, domain history.
2. **What changed** — the same facts as a time series, so a price rise, a tier rename, a licence
   change or a new vendor is dated rather than guessed at.

## What makes the data different

- **Vendor stack from public DNS.** When a company buys a SaaS tool, the tool usually asks them to
  publish a TXT record proving domain ownership. That record stays in public DNS, so the purchase
  list is published. BuiltWith and Wappalyzer detect frontend scripts; this sees back-office
  purchases — HR, feature flags, security scanners, cap-table software, AI tooling — that ship no
  script tag.
- **Pricing read structurally.** Tier names, monthly and annual prices, per-seat basis and product
  lines, taken from schema.org markup where a company publishes it and from the page text where it
  does not. How each number was read is recorded alongside it.
- **Provenance on every fact.** Source URL, a verbatim quote where one exists, and a confidence
  score. Nothing is asserted that cannot be checked.
- **History is back-filled** from public archives, so pricing history starts years before we did.

## Honest limits

- A DNS verification record proves a relationship existed, not current paid use.
- Pricing pages localise to the requester, so a recorded currency is the one our crawler was shown.
- We read public sources only. We honour robots.txt, never bypass bot protection, and never use
  LinkedIn.
- We aggregate to the company and never build profiles of individuals.

## Pages

- [Company dossiers](${abs("/c/linear.app")}): \`/c/{domain}\` — everything verifiable about one company now.
- [Vendor adoption](${abs("/stack")}): \`/stack/{vendor}\` — which companies buy a given tool. ${vendors.length} vendors indexed.
- [Head-to-head](${abs("/compare")}): \`/compare/{a}-vs-{b}\` — two companies side by side. ${pairs.length} comparisons.
- [API & MCP docs](${abs("/docs")}): how to connect an agent, and what self-hosting needs.
- [Privacy](${abs("/privacy")}) · [Terms](${abs("/terms")})

## Index size

- Companies indexed for vendor data: ${ix.domainsIndexed}
- Distinct vendors detected: ${ix.vendors.length} (${vendors.length} with two or more companies)
- Comparison pages: ${pairs.length}
- Seed companies with dossiers: ${SEED.length}
- Vendor index generated: ${ix.generatedAt.slice(0, 10)}

## Most-adopted vendors

${top.map((v) => `- [${v.vendor}](${abs(`/stack/${v.vendor}`)}): ${v.domains.length} of ${ix.domainsIndexed} companies`).join("\n")}

## For agents

A metered REST API and an MCP server expose the same named queries the site uses.
Free, open source and unauthenticated — no key, no account, no quota.
The query catalogue is at \`${abs("/api/v1")}\`; POST to \`/api/v1/{query}\` to run one.

## For agents

Every public page has a Markdown twin: append \`.md\` to any URL.

- ${abs("/c/linear.app")}.md
- ${abs("/stack/anthropic")}.md
- ${abs("/compare/asana.com-vs-linear.app")}.md

Markdown pages carry the same facts with their source URLs and no markup.
Each HTML page also declares its twin via <link rel="alternate" type="text/markdown">.

MCP server (Streamable HTTP): ${abs("/api/mcp")}
Claude Skill: ${abs("/skill/SKILL.md")}
REST API: ${abs("/api/v1/company_dossier")}
`;

  return text;
}

export async function GET() {
  return new Response(await body(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Stable enough to cache hard; it only changes when the index is rebuilt.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
