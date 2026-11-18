/**
 * The public company page — the free tier AND the acquisition engine.
 *
 * Two product decisions are enforced here:
 *
 *  1. GIVE AWAY THE PRESENT, CHARGE FOR THE PAST. Anyone could read a
 *     competitor's pricing page themselves, so charging for current state is
 *     charging for nothing. History is structurally unreplicable, so it is the
 *     product. This page therefore shows everything we can see RIGHT NOW and
 *     locks the time series behind the paywall.
 *  2. PROVENANCE IS THE BRAND. Every number carries its source and, where we
 *     have one, the verbatim quote it came from. A fact you cannot check is a
 *     fact we will not publish.
 *
 * Caching: `params` is request-time data, so it is read in the page and passed
 * as an ARGUMENT into a `use cache` scope — the pattern the Cache Components
 * docs prescribe. The cache key is then the domain alone, which is what makes
 * per-domain revalidation possible and stops a popular page re-crawling.
 *
 * No `export const runtime`: Cache Components rejects it.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { factsFor } from "@/lib/cached-dossier";
import { factLabel, publicDomain } from "@/lib/public-dossier";
import { footprintOf, identityOf, interpret, type Signal } from "@/lib/interpret";
import { countryName } from "@/lib/worldmap";
import { FootprintMap, hasFootprint } from "../../footprint";
import { CHECKOUT_URL } from "@/lib/offer";
import { abs, SITE_NAME } from "@/lib/site";
import { JsonLd } from "../../jsonld";
import { SectionHead, ThemeToggle } from "../../ui";
import { AskAbout } from "../../ask";

export async function generateMetadata(props: PageProps<"/c/[domain]">) {
  // Built from the DOMAIN ALONE, on purpose. Calling the dossier here would
  // crawl a second time per page view and would hit the same prerender
  // constraints the page body does.
  const { domain: rawDomain } = await props.params;
  const domain = publicDomain(rawDomain);
  if (!domain) return { title: "Company not found" };
  return {
    title: `${domain} — company intelligence, with sources`,
    description:
      `What can be verified about ${domain} right now from public sources: published pricing, ` +
      `vendor stack, security posture, legal entity and domain history — every fact linked to the page it came from.`,
    alternates: { canonical: `/c/${domain}` },
    openGraph: {
      title: `${domain} — company intelligence`,
      description: `Verifiable facts about ${domain} from public sources, each linked to its origin.`,
      url: `/c/${domain}`,
      type: "website",
      siteName: SITE_NAME,
      // A child `openGraph` REPLACES the parent's rather than merging, so the
      // root opengraph-image must be named here or the share card is lost.
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${domain} — company intelligence`,
      images: ["/opengraph-image"],
    },
  };
}

export default function CompanyPage(props: PageProps<"/c/[domain]">) {
  // `params` is NOT awaited here. Under Cache Components an unbounded dynamic
  // route must prerender a static shell, and awaiting params at the top blocks
  // it — so the promise is handed to a Suspense boundary instead.
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <nav className="mb-10 flex items-center justify-between gap-4">
        <Link href="/" className="mono t-small no-underline">{SITE_NAME}</Link>
        <div className="flex items-center gap-3">
          <Link href="/#pricing" className="t-small no-underline">Pricing</Link>
          <ThemeToggle />
        </div>
      </nav>

      <Suspense fallback={<Loading />}>
        <Resolved params={props.params} />
      </Suspense>
    </main>
  );
}

/** Resolves the param, enforces the SSRF guard, then renders the dossier. */
async function Resolved({ params }: { params: PageProps<"/c/[domain]">["params"] }) {
  const { domain: rawDomain } = await params;
  const domain = publicDomain(rawDomain);
  // A refused domain is a 404, not an error page — and this is the SSRF boundary.
  if (!domain) notFound();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `${domain} — company intelligence`,
          url: abs(`/c/${domain}`),
          about: { "@type": "Organization", name: domain, url: `https://${domain}` },
          isPartOf: { "@type": "WebSite", name: SITE_NAME, url: abs("/") },
        }}
      />
      <header className="mb-10">
        <p className="eyebrow mb-2">Company intelligence</p>
        <h1 className="t-display break-words">{domain}</h1>
      </header>
      <Dossier domain={domain} />
    </>
  );
}

function Loading() {
  return (
    <>
      <header className="mb-10">
        <p className="eyebrow mb-2">Company intelligence</p>
        <h1 className="t-display muted">Reading public sources…</h1>
      </header>
      <div className="card">
        <p className="t-body">Fetching this live from public sources.</p>
        <p className="t-small muted mt-2">
          A few seconds the first time, then it is cached for everyone.
        </p>
      </div>
    </>
  );
}

async function Dossier({ domain }: { domain: string }) {
  const { facts, source } = await factsFor(domain);

  if (facts.size === 0) {
    return (
      <div className="card p-6">
        <h2 className="t-h3 m-0">Nothing readable yet</h2>
        <p className="t-body mt-2">
          We could not read anything public for <span className="mono">{domain}</span>. That usually means the
          site blocks automated readers, is behind a login, or the domain is not live.
        </p>
      </div>
    );
  }

  const id = identityOf(facts);
  const signals = interpret(facts);
  const footprint = footprintOf(facts);
  const vendors = (facts.get("stack.vendors.list")?.value ?? "")
    .split(",").map((v) => v.trim()).filter(Boolean);
  const h1 = facts.get("positioning.h1")?.value ?? null;

  return (
    <>
      {/* --- Identity. Who this is, before anything is claimed about them. */}
      <header className="mb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h1 className="t-display break-words m-0">{domain}</h1>
          {id.type && id.type !== "unknown" && <span className="pill t-micro">{id.type}</span>}
        </div>

        {/* The legal line. An unresolved entity says so rather than going blank,
            because "we looked and could not tell" is itself information. */}
        <p className="t-small muted mt-3 mb-0">
          {id.legalName ? (
            <strong style={{ color: "var(--ink)" }}>{id.legalName}</strong>
          ) : id.candidateName ? (
            /* A registry entity shares this name but could not be tied to this
               company, so it is offered as a lead and labelled as one. */
            <>
              Legal entity unconfirmed — registry has{" "}
              <em>{id.candidateName}</em>
              {id.candidateCountry ? ` (${id.candidateCountry})` : ""} among{" "}
              {id.candidates ?? "several"} same-name entities
            </>
          ) : id.unresolved ? (
            <>Legal entity not resolved — no exact match in the registry</>
          ) : null}
          {id.vat && <> · VAT {id.vat}</>}
          {id.founded && <> · founded {id.founded.slice(0, 4)}</>}
          {footprint.registered && <> · {countryName(footprint.registered)}</>}
        </p>

        {/* Their own words, quoted. The cheapest read on positioning there is. */}
        {h1 && <p className="t-h3 mt-4 mb-0" style={{ maxWidth: "40ch" }}>“{h1}”</p>}
      </header>

      {hasFootprint(footprint) && <FootprintMap footprint={footprint} domain={domain} />}

      {/* --- The signals. Each tile is a sentence, not a key-value pair. */}
      {signals.length > 0 && (
        <section className="mb-12">
          <SectionHead eyebrow="what matters" title="Read in one pass" />
          <div className="bento">
            {signals.map((s) => <Tile key={s.id} signal={s} />)}
          </div>
        </section>
      )}

      {/* --- Navigation out. Every vendor is a page of its own. */}
      {vendors.length > 0 && (
        <section className="mb-12">
          <SectionHead eyebrow="what they run on" title={`${vendors.length} vendors, from public DNS`} />
          <div className="flex flex-wrap gap-2">
            {vendors.map((v) => (
              <Link key={v} href={`/stack/${v}`} className="chip no-underline">
                {v.split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ")}
              </Link>
            ))}
          </div>
          <p className="t-micro muted mt-3">
            A verification record proves a relationship with the vendor, not its size or price.
            Each one links to every other company we see using it.
          </p>
        </section>
      )}

      {/* --- The paywall, stated as the honest difference it is. */}
      <section className="mb-12">
        <div className="card card-shell p-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div>
            <p className="eyebrow mb-2">The part you cannot look up</p>
            <h2 className="t-h3 m-0">What did this page say last March?</h2>
            <p className="t-body mt-2 mb-0" style={{ maxWidth: "48ch" }}>
              Everything above is current state, and you could verify all of it yourself today.
              What you cannot get is the version from three months ago — the tier that moved, the
              vendor that appeared, the week the hiring stopped.
            </p>
          </div>
          <div className="mt-5 sm:mt-0 shrink-0">
            <a href={CHECKOUT_URL} className="btn btn-primary no-underline">See the history</a>
          </div>
        </div>
      </section>

      {/* --- The raw table, available but not thrown at the reader. */}
      <section className="mb-12">
        <details className="card">
          <summary className="t-h3" style={{ cursor: "pointer", padding: "1rem 1.25rem", listStyle: "none" }}>
            Every fact we hold · {facts.size}
            <span className="t-micro muted"> — with sources</span>
          </summary>
          <div style={{ padding: "0 1.25rem 1.25rem" }}>
            <table className="fact-table">
              <thead>
                <tr>
                  <th scope="col">Fact</th>
                  <th scope="col">Value</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {[...facts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, f]) => (
                  <tr key={path}>
                    <th scope="row">
                      {factLabel(path)}
                      <span className="mono t-micro muted block">{path}</span>
                    </th>
                    <td>
                      {renderValue(f.value)}
                      {/* Confidence is DISCLOSED, not hidden: a parsed value is
                          weaker evidence than a published one. */}
                      {typeof f.confidence === "number" && f.confidence < 0.85 && (
                        <span className="t-micro muted"> · ~{Math.round(f.confidence * 100)}%</span>
                      )}
                      {f.quote && <span className="t-micro muted block mt-1">“{f.quote}”</span>}
                    </td>
                    <td>{f.sourceUrl ? <Source url={f.sourceUrl} /> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="t-micro muted mt-2">
          {source === "store"
            ? "From our index, refreshed at 00:00 and 12:00 UTC."
            : "Read live from public sources just now, because this company is not tracked yet."}
        </p>
      </section>
    </>
  );
}

/**
 * One signal.
 *
 * The headline is what a person would say; the line under it is why it
 * matters. The source link is what separates this from an opinion.
 */
function Tile({ signal: s }: { signal: Signal }) {
  const body = (
    <>
      <p className="eyebrow mb-2">{s.label}</p>
      <p className="tile-headline m-0">{s.headline}</p>
      <p className="t-small muted mt-2 mb-0">{s.meaning}</p>
      {s.sourceUrl && (
        <p className="t-micro mt-3 mb-0" style={{ overflowWrap: "anywhere" }}>
          <Source url={s.sourceUrl} />
        </p>
      )}
    </>
  );

  const cls = `tile tile-${s.size}${s.tone === "good" ? " tile-good" : s.tone === "warn" ? " tile-warn" : ""}`;
  return s.href ? (
    <Link href={s.href} className={`${cls} no-underline`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A DNS "source" is not a link, so render it as text rather than a dead anchor. */
function Source({ url }: { url: string }) {
  if (!/^https?:\/\//.test(url)) return <span className="mono muted">{url}</span>;
  let label = url;
  try {
    const u = new URL(url);
    label = u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch { /* keep the raw string */ }
  return (
    <a href={url} rel="nofollow noopener noreferrer" target="_blank" className="mono">
      {label.slice(0, 70)}
    </a>
  );
}

function renderValue(v: unknown) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined) return <span className="muted">unknown</span>;
  const s = String(v);
  // Comma lists (vendor stacks, tier names) read far better as pills.
  if (s.includes(",") && s.length < 600 && !s.includes(" ,")) {
    const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1 && parts.length <= 40) {
      return (
        <span className="flex flex-wrap gap-1.5">
          {parts.map((p) => (
            <span key={p} className="pill">{p}</span>
          ))}
        </span>
      );
    }
  }
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

const MODULE_TITLES: Record<string, string> = {
  "0. Discovery": "Apps and profiles",
  "1. Positioning": "How they describe themselves",
  "2. Pricing": "Published pricing",
  "3. Product & releases": "Product and releases",
  "4. Unannounced signals": "Signals they have not announced",
  "7. Vendor & tech stack": "What they run on",
  "13. Attention & demand": "Reach and age",
  "14. Corporate": "Legal entity",
  "15. Reliability & security posture": "Security posture",
};
const titleFor = (module: string) => MODULE_TITLES[module] ?? module.replace(/^\d+\.\s*/, "");
