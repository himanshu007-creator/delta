/**
 * "Companies using X" — the page type BuiltWith draws enormous organic traffic
 * from, except our data is different in kind.
 *
 * BuiltWith and Wappalyzer detect FRONTEND SCRIPTS. We read public DNS TXT
 * verification records, which reveal BACK-OFFICE purchases — HR (Rippling),
 * feature flags (LaunchDarkly), security (Wiz, HackerOne), cap table (Carta),
 * AI tooling (Anthropic, Cursor). None of that ships a script tag, so none of
 * it is visible to script detection.
 *
 * Fully STATIC: every page is prerendered from a committed index, so there is
 * no request-time crawling at all. `dynamicParams = false` means an unknown
 * vendor is a real framework 404 rather than a 200 with 404-shaped UI.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  isPageworthyVendor, relatedVendors, stackIndex, vendorRow, vendorSlug,
} from "@/lib/stack-index";
import { abs, SITE_NAME } from "@/lib/site";
import { JsonLd } from "../../jsonld";
import { SectionHead, ThemeToggle } from "../../ui";

/**
 * NOTE: `dynamicParams = false` would be the natural way to reject unknown
 * vendors, but Cache Components rejects that segment config outright. So the
 * slug is validated in `proxy.ts` against a generated allowlist, which returns
 * a real 404 before streaming starts — the same approach /c/[domain] uses.
 */

export async function generateStaticParams() {
  // A vendor with one company is thin content and should not be a page.
  return stackIndex()
    .vendors.filter((v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor))
    .map((v) => ({ vendor: v.vendor }));
}

const pretty = (slug: string) =>
  slug.split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");

export async function generateMetadata(props: PageProps<"/stack/[vendor]">) {
  const { vendor: raw } = await props.params;
  const slug = vendorSlug(raw);
  const row = slug ? vendorRow(slug) : null;
  if (!row) return { title: "Vendor not found" };
  const name = pretty(row.vendor);
  return {
    title: `${row.domains.length} companies using ${name}`,
    description:
      `${row.domains.length} companies with a public ${name} domain-verification record, found in DNS. ` +
      `Back-office purchases that frontend script detection cannot see. Every company linked, with the evidence.`,
    alternates: { canonical: `/stack/${row.vendor}` },
    openGraph: {
      title: `${row.domains.length} companies using ${name}`,
      description: `Companies with a public ${name} domain-verification record, found in DNS.`,
      url: `/stack/${row.vendor}`,
      type: "website",
      siteName: SITE_NAME,
      // A child `openGraph` REPLACES the parent's rather than merging, so the
      // root opengraph-image must be named here or the share card is lost.
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${row.domains.length} companies using ${name}`,
      images: ["/opengraph-image"],
    },
  };
}

export default async function VendorPage(props: PageProps<"/stack/[vendor]">) {
  const { vendor: raw } = await props.params;
  const slug = vendorSlug(raw);
  const row = slug ? vendorRow(slug) : null;
  if (!row || !isPageworthyVendor(row.vendor)) notFound();

  const ix = stackIndex();
  const name = pretty(row.vendor);
  const share = Math.round((row.domains.length / Math.max(1, ix.domainsIndexed)) * 100);
  const related = relatedVendors(row.vendor);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      {/* An ItemList is the honest shape here: this page IS a list of companies. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `Companies using ${name}`,
          description: `${row.domains.length} companies with a public ${name} domain-verification record.`,
          url: abs(`/stack/${row.vendor}`),
          numberOfItems: row.domains.length,
          itemListElement: row.domains.slice(0, 100).map((d, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: { "@type": "Organization", name: d, url: `https://${d}`, sameAs: abs(`/c/${d}`) },
          })),
        }}
      />
      <nav className="mb-10 flex items-center justify-between gap-4">
        <Link href="/" className="mono t-small no-underline">{SITE_NAME}</Link>
        <div className="flex items-center gap-3">
          <Link href="/stack" className="t-small no-underline">All vendors</Link>
          <Link href="/#pricing" className="t-small no-underline">Pricing</Link>
          <ThemeToggle />
        </div>
      </nav>

      <header className="mb-8">
        <p className="eyebrow mb-2">Vendor adoption</p>
        <h1 className="t-display">{row.domains.length} companies using {name}</h1>
        <p className="t-body muted mt-3">
          {row.domains.length} of {ix.domainsIndexed} companies we have indexed — <strong>{share}%</strong> — publish a{" "}
          {name} domain-verification record in their public DNS.
        </p>
      </header>

      <section className="mb-10">
        <SectionHead eyebrow="Evidence" title="How we know this" />
        <div className="card">
          <p className="t-body">
            When a company buys a SaaS tool, the tool usually asks them to prove they own their
            domain by publishing a <span className="mono">TXT</span> record. That record stays in
            public DNS, so the company&rsquo;s purchase list ends up published — one query, no login.
          </p>
          <p className="t-body mt-3">
            This is why our list differs from the usual ones: <strong>BuiltWith and Wappalyzer
            detect frontend scripts.</strong> HR systems, feature flags, security scanners, cap-table
            software and AI tooling never ship a script tag, so script detection cannot see them.
            DNS can.
          </p>
          <p className="t-small muted mt-3">
            ⚠️ A verification record proves a <strong>relationship existed</strong>, not current paid
            use — a company may have trialled a tool and left the record behind. Treat it as strong
            evidence, not a contract.
          </p>
        </div>
      </section>

      <section className="mb-10">
        <SectionHead eyebrow="Companies" title={`Who uses ${name}`} />
        <div className="card">
          <ul className="grid gap-2 sm:grid-cols-2">
            {row.domains.map((d) => (
              <li key={d} className="min-w-0">
                <Link href={`/c/${d}`} className="mono t-small" style={{ overflowWrap: "anywhere" }}>
                  {d}
                </Link>
              </li>
            ))}
          </ul>
          <p className="t-small muted mt-4">
            Each links to that company&rsquo;s full dossier — pricing, stack, security posture and more.
          </p>
        </div>
      </section>

      {related.length > 0 && (
        <section className="mb-10">
          <SectionHead eyebrow="Correlation" title={`Also bought by ${name} customers`} />
          <div className="card card-quiet">
            <p className="t-small muted mb-3">
              Vendors appearing most often alongside {name} across the same companies.
            </p>
            <ul className="flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.vendor}>
                  <Link href={`/stack/${r.vendor}`} className="pill no-underline">
                    {pretty(r.vendor)} · {r.domains.length}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="card card-shell">
          <h2 className="t-h3">Watch a vendor&rsquo;s customer list change</h2>
          <p className="t-body mt-2">
            A TXT record appearing means a company <strong>just bought something</strong>. A record
            disappearing means they left. We track that over time, so you see adoption and churn as
            it happens rather than as a snapshot.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href="/#pricing" className="btn btn-primary no-underline">See the changes</Link>
            <Link href="/stack" className="t-small no-underline">Browse all {ix.vendors.length} vendors</Link>
          </div>
        </div>
      </section>

      <footer className="t-small muted border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p>
          From public DNS records only. Index of {ix.domainsIndexed} companies, generated{" "}
          {ix.generatedAt.slice(0, 10)}.
        </p>
        <p className="mt-2">
          <Link href="/">{SITE_NAME}</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/terms">Terms</Link>
        </p>
      </footer>
    </main>
  );
}
