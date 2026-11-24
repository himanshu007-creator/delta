/**
 * The company directory — the index that was missing.
 *
 * /stack and /compare each had a hub page; /c did not, so there was no way to
 * browse companies at all. You had to already know a domain, which makes every
 * company page an orphan: reachable from a search engine, from nowhere inside
 * the site.
 *
 * Grouped by category rather than listed A–Z, because "who else is in this
 * market" is the question someone browsing actually has.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { SEED, comparablePairs } from "@/lib/seed";
import { stackIndex } from "@/lib/stack-index";
import { SITE_NAME, abs } from "@/lib/site";
import { JsonLd } from "../jsonld";
import { SectionHead } from "../ui";
import { SiteNav } from "../nav";
import { SiteFooter } from "../ui";
import { AskAbout } from "../ask";

export const metadata: Metadata = {
  title: "Every company we track",
  description:
    `All ${SEED.length} companies ${SITE_NAME} tracks, grouped by market — pricing, vendor stack, ` +
    `security posture and legal entity for each, from public sources with every fact linked.`,
  alternates: { canonical: "/c", types: { "text/markdown": "/c.md" } },
  openGraph: { title: "Every company we track", url: "/c", images: ["/opengraph-image"] },
};

/** Human labels for the seed's category slugs. */
const CATEGORY: Record<string, string> = {
  "dev-infra": "Developer infrastructure",
  productivity: "Productivity",
  "sales-marketing": "Sales and marketing",
  fintech: "Fintech and payments",
  "hr-ops": "HR and operations",
  security: "Security",
  ai: "AI",
  retail: "Retail and consumer",
  industry: "Industry and property",
};

export default function CompanyIndex() {
  const ix = stackIndex();
  // Vendor count per domain, so each row says something rather than being a
  // bare link. It comes from the committed index, so this stays static.
  const vendorCount = new Map(ix.entries.map((e) => [e.domain, e.vendors.length]));
  const pairCount = comparablePairs().length;

  const byCategory = new Map<string, typeof SEED[number][]>();
  for (const c of SEED) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const groups = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Every company we track",
          url: abs("/c"),
          isPartOf: { "@type": "WebSite", name: SITE_NAME, url: abs("/") },
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: SEED.length,
            itemListElement: SEED.slice(0, 50).map((c, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: abs(`/c/${c.domain}`),
              name: c.name,
            })),
          },
        }}
      />

      <SiteNav here="companies" />

      <header className="mb-10">
        <p className="eyebrow mb-2">Directory</p>
        <h1 className="t-display m-0">Every company we track</h1>
        <p className="t-body muted mt-3" style={{ maxWidth: "58ch" }}>
          {SEED.length} companies across {groups.length} markets, refreshed twice daily. Each page
          carries pricing, vendor stack, security posture and legal entity — every fact linked to
          the page it came from.
        </p>
        <p className="t-micro muted mt-3">
          Looking for a company that is not here?{" "}
          <Link href="/docs">query it through the API</Link> and it is crawled live on the next
          window. The public pages work for any domain: try{" "}
          <Link href="/c/gymshark.com">/c/gymshark.com</Link>.
        </p>
      </header>

      <p className="t-micro muted mb-6">
        The number beside each company is how many vendors we read from its public DNS.
      </p>

      {groups.map(([cat, list]) => (
        <section key={cat} className="mb-10">
          <SectionHead eyebrow={`${list.length} companies`} title={CATEGORY[cat] ?? cat} />
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 list-none p-0 m-0">
            {list
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <li key={c.domain} className="dir-row">
                  <Link href={`/c/${c.domain}`} className="no-underline dir-name">
                    {c.name}
                  </Link>
                  {/* The vendor count is the one number that makes a row worth
                      scanning: it says how much we actually hold. Titled,
                      because a bare integer in a list is a riddle. */}
                  <span
                    className="mono t-micro muted"
                    title={`${vendorCount.get(c.domain) ?? 0} vendors read from ${c.domain}'s public DNS`}
                  >
                    {vendorCount.get(c.domain) ?? 0}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <p className="t-micro muted mb-10">
        The number is how many vendors we read from that company&rsquo;s public DNS. Compare any two
        in the same market across {pairCount.toLocaleString("en-GB")}{" "}
        <Link href="/compare">head-to-head pages</Link>, or browse by{" "}
        <Link href="/stack">vendor</Link>.
      </p>

      <AskAbout
        className="mb-10"
        path="/c"
        ask={`Which of these companies would be most useful to track for someone selling developer tools, and why?`}
      />

      <SiteFooter />
    </main>
  );
}
