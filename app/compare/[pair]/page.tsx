/**
 * Head-to-head comparison — the highest-intent page type in SaaS SEO
 * ("notion vs linear" is a real query with real buying intent).
 *
 * Two parts, deliberately:
 *
 *  1. STATIC: the stack comparison, from the committed vendor index. Instant,
 *     prerendered, and the genuinely novel bit — "what Notion buys that Linear
 *     doesn't" is a question nobody else can answer, because it comes from DNS
 *     records rather than page scripts.
 *  2. STREAMED: live facts side by side (pricing, security, age), behind
 *     Suspense and sharing the per-domain cache with /c/[domain] — so a
 *     comparison reuses whatever the company pages already warmed.
 *
 * Pairs are generated WITHIN A CATEGORY only: 690 pages rather than 6,105, and
 * every one is a comparison a human would actually search for.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { factsFor } from "@/lib/cached-dossier";
import { comparablePairs, pairKey, parsePair, seedFor, stackIndex } from "@/lib/stack-index";
import { abs, SITE_NAME } from "@/lib/site";
import { JsonLd } from "../../jsonld";
import { SectionHead, ThemeToggle } from "../../ui";
import { AskAbout } from "../../ask";

export async function generateStaticParams() {
  return comparablePairs().map((p) => ({ pair: p.slug }));
}

const nameOf = (domain: string) => seedFor(domain)?.name ?? domain;

export async function generateMetadata(props: PageProps<"/compare/[pair]">) {
  const { pair } = await props.params;
  const parsed = parsePair(pair);
  if (!parsed) return { title: "Comparison not found" };
  const [A, B] = [nameOf(parsed.a), nameOf(parsed.b)];
  return {
    title: `${A} vs ${B}`,
    description:
      `A side-by-side of ${A} and ${B} built from public records: the vendors each one buys, ` +
      `published pricing, security posture and domain history. Every fact linked to its source.`,
    alternates: { canonical: `/compare/${pair}` },
    openGraph: {
      title: `${A} vs ${B}`,
      description: `What ${A} and ${B} each run on, publish and charge — from public records.`,
      url: `/compare/${pair}`,
      type: "website",
      siteName: SITE_NAME,
      // A child `openGraph` REPLACES the parent's rather than merging, so the
      // root opengraph-image must be named here or the share card is lost.
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${A} vs ${B}`,
      images: ["/opengraph-image"],
    },
  };
}

export default function ComparePage(props: PageProps<"/compare/[pair]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <nav className="mb-10 flex items-center justify-between gap-4">
        <Link href="/" className="mono t-small no-underline">{SITE_NAME}</Link>
        <div className="flex items-center gap-3">
          <Link href="/compare" className="t-small no-underline">All comparisons</Link>
          <Link href="/stack" className="t-small no-underline">Vendors</Link>
          <ThemeToggle />
        </div>
      </nav>
      <Suspense fallback={<p className="t-body muted">Loading comparison…</p>}>
        <Resolved params={props.params} />
      </Suspense>
    </main>
  );
}

async function Resolved({ params }: { params: PageProps<"/compare/[pair]">["params"] }) {
  const { pair } = await params;
  const parsed = parsePair(pair);
  if (!parsed) notFound();
  // One canonical URL per pair; the proxy redirects the reversed order here.
  if (pairKey(parsed.a, parsed.b) !== pair) notFound();

  const { a, b } = parsed;
  const [A, B] = [nameOf(a), nameOf(b)];
  const ix = stackIndex();
  const va = new Set(ix.entries.find((e) => e.domain === a)?.vendors ?? []);
  const vb = new Set(ix.entries.find((e) => e.domain === b)?.vendors ?? []);

  const shared = [...va].filter((v) => vb.has(v)).sort();
  const onlyA = [...va].filter((v) => !vb.has(v)).sort();
  const onlyB = [...vb].filter((v) => !va.has(v)).sort();
  const union = new Set([...va, ...vb]).size;
  // Jaccard: how much of their combined stack they hold in common.
  const similarity = union ? Math.round((shared.length / union) * 100) : 0;

  const siblings = comparablePairs()
    .filter((p) => p.slug !== pair && (p.a === a || p.b === a || p.a === b || p.b === b))
    .slice(0, 10);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `${A} vs ${B}`,
          url: abs(`/compare/${pair}`),
          description: `A side-by-side of ${A} and ${B} built from public records.`,
          about: [
            { "@type": "Organization", name: A, url: `https://${a}`, sameAs: abs(`/c/${a}`) },
            { "@type": "Organization", name: B, url: `https://${b}`, sameAs: abs(`/c/${b}`) },
          ],
        }}
      />
      <header className="mb-8">
        <p className="eyebrow mb-2">Head to head</p>
        <h1 className="t-display">{A} vs {B}</h1>
        <p className="t-body muted mt-3">
          Built from public records only — DNS, their own pages, public archives. Every fact below
          links to where it came from.
        </p>
      </header>

      {(va.size > 0 || vb.size > 0) && (
        <section className="mb-10">
          <SectionHead eyebrow="Vendor stack" title="What each one buys" />
          <div className="card">
            <p className="t-body">
              {va.size > 0 && vb.size > 0 ? (
                <>
                  Their stacks overlap by <strong>{similarity}%</strong> — {shared.length} vendors in
                  common out of {union} between them.
                </>
              ) : (
                <>We have vendor records for only one of these two so far.</>
              )}
            </p>
            <p className="t-small muted mt-2">
              Read from public DNS verification records, so these are <strong>purchases</strong> —
              including back-office tools that ship no script tag and are therefore invisible to
              BuiltWith or Wappalyzer.
            </p>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <VendorColumn title={`Only ${A}`} domain={a} vendors={onlyA} />
              <VendorColumn title={`Only ${B}`} domain={b} vendors={onlyB} />
            </div>

            {shared.length > 0 && (
              <div className="mt-6">
                <p className="t-micro muted mb-2">Both use</p>
                <ul className="flex flex-wrap gap-1.5">
                  {shared.map((v) => (
                    <li key={v}>
                      <Link href={`/stack/${v}`} className="pill no-underline">{v}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="t-small muted mt-4">
              ⚠️ A verification record proves a relationship existed, not current paid use.
            </p>
          </div>
        </section>
      )}

      <section className="mb-10">
        <SectionHead eyebrow="Side by side" title="What they publish today" />
        <Suspense fallback={<div className="card"><p className="t-body">Reading both sites live…</p></div>}>
          <LiveComparison a={a} b={b} A={A} B={B} />
        </Suspense>
      </section>

      {siblings.length > 0 && (
        <section className="mb-10">
          <SectionHead eyebrow="Related" title="Other comparisons" />
          <div className="card card-quiet">
            <ul className="flex flex-wrap gap-2">
              {siblings.map((p) => (
                <li key={p.slug}>
                  <Link href={`/compare/${p.slug}`} className="pill no-underline">
                    {nameOf(p.a)} vs {nameOf(p.b)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="card card-shell">
          <h2 className="t-h3">This is today. The useful part is the change.</h2>
          <p className="t-body mt-2">
            A comparison is a snapshot. What moves a decision is <strong>which of them is
            changing</strong> — who repriced, who shipped, who added a vendor, whose security
            posture improved. We track both over time and tell you when either moves.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href="/#pricing" className="btn btn-primary no-underline">Track both</Link>
            <Link href={`/c/${a}`} className="t-small no-underline">Full {A} dossier</Link>
            <Link href={`/c/${b}`} className="t-small no-underline">Full {B} dossier</Link>
          </div>
        </div>
      </section>

      <AskAbout
        className="mb-10"
        path={`/compare/${a}-vs-${b}`}
        ask={`How do ${A} and ${B} compare on pricing, tech stack and momentum — and which one looks like it is gaining?`}
      />

      <footer className="t-small muted border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p>Public sources only. We honour robots.txt and never use LinkedIn.</p>
        <p className="mt-2">
          <Link href="/">{SITE_NAME}</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/terms">Terms</Link>
        </p>
      </footer>
    </>
  );
}

function VendorColumn({ title, domain, vendors }: { title: string; domain: string; vendors: string[] }) {
  return (
    <div className="min-w-0">
      <p className="t-micro muted mb-2">
        {title} <span className="mono">({vendors.length})</span>
      </p>
      {vendors.length === 0 ? (
        <p className="t-small muted">Nothing unique to {domain} in our index.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {vendors.slice(0, 40).map((v) => (
            <li key={v}>
              <Link href={`/stack/${v}`} className="pill no-underline">{v}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The live half — REQUEST-TIME only.
 *
 * `connection()` stops prerendering here, and that is load-bearing: without it
 * the build tried to resolve two company dossiers for each of 690 comparison
 * pages and failed with "a `use cache` function took too long during
 * prerendering". The static shell above (the stack comparison) is the part
 * worth prerendering; this part streams.
 *
 * Reads the STORE first, so after a crawl window this is two indexed queries
 * rather than ~50 HTTP requests.
 */
async function LiveComparison({ a, b, A, B }: { a: string; b: string; A: string; B: string }) {
  await connection();
  const [da, db] = await Promise.all([factsFor(a), factsFor(b)]);

  const ROWS: { label: string; path: string }[] = [
    { label: "Pricing published", path: "pricing.visible" },
    { label: "Pricing tiers", path: "pricing.tiers.count" },
    { label: "Tier names", path: "pricing.tiers.names" },
    { label: "Has a free tier", path: "pricing.has_free" },
    { label: "Contact-sales tier", path: "pricing.has_custom" },
    { label: "Currency shown to us", path: "pricing.currency_observed" },
    { label: "Publishes llms.txt", path: "product.llmstxt.present" },
    { label: "Vendors detected", path: "stack.vendors.count" },
    { label: "Email provider", path: "stack.email_provider" },
    { label: "DMARC policy", path: "security.dmarc_policy" },
    { label: "Open-source licence", path: "product.github.license_detected" },
    { label: "Security score (OpenSSF)", path: "security.scorecard.score" },
    { label: "Open roles", path: "hiring.open_roles" },
    { label: "Domain age (years)", path: "history.domain_age_years" },
    { label: "Pages in sitemap", path: "site.sitemap.urls" },
    { label: "AI crawlers blocked", path: "site.ai_crawlers_blocked" },
    { label: "Has an iOS app", path: "discovered.has_ios_app" },
  ];

  const rows = ROWS.map((r) => ({
    ...r,
    av: da.facts.get(r.path)?.value ?? null,
    bv: db.facts.get(r.path)?.value ?? null,
  }))
    // A row where neither side has data teaches nothing; drop it.
    .filter((r) => r.av !== null || r.bv !== null);

  if (!rows.length) {
    return (
      <div className="card">
        <p className="t-body">We have not read either site yet.</p>
        <p className="t-small muted mt-2">
          The stack comparison above comes from DNS and is already complete.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th className="t-micro muted" style={{ textAlign: "left", paddingBottom: 8 }} />
            <th className="t-small" style={{ textAlign: "left", paddingBottom: 8 }}>{A}</th>
            <th className="t-small" style={{ textAlign: "left", paddingBottom: 8 }}>{B}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="t-micro muted" style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>{r.label}</td>
              <td className="t-small" style={{ padding: "8px 12px 8px 0", verticalAlign: "top", overflowWrap: "anywhere" }}>{cell(r.av)}</td>
              <td className="t-small" style={{ padding: "8px 0", verticalAlign: "top", overflowWrap: "anywhere" }}>{cell(r.bv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-small muted mt-4">
        {da.count} facts for {A}, {db.count} for {B}
        {da.source === "store" && db.source === "store"
          ? ", from our index."
          : ", read live from public sources."}
      </p>
    </div>
  );
}

function cell(v: string | number | boolean | null) {
  if (v === null) return <span className="muted">—</span>;
  if (v === true) return "Yes";
  if (v === false) return "No";
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}
