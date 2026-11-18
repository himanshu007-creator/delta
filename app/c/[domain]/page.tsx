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
import { cachedDossier } from "@/lib/cached-dossier";
import { factLabel, isPublicFact, publicDomain } from "@/lib/public-dossier";
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
  const d = await cachedDossier(domain);

  if (!d.factCount) {
    return (
      <div className="card">
        <h2 className="t-h3">Nothing readable yet</h2>
        <p className="t-body mt-2">
          We could not read anything public for <span className="mono">{domain}</span>. That usually means the
          site blocks automated readers, is behind a login, or the domain is not live.
        </p>
        {d.unavailable.length > 0 && (
          <p className="t-small muted mt-3">
            Tried and could not read: {d.unavailable.map((u) => `${u.label} (${u.reason})`).join(", ")}.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <section className="mb-10">
        <div className="card">
          <p className="t-body">
            <strong>{d.factCount} facts</strong> from <strong>{d.sources.length} public sources</strong>
            {d.companyType && d.companyType !== "unknown" ? <> · classified as <strong>{d.companyType}</strong></> : null}
            {d.title ? <> · “{d.title}”</> : null}
          </p>
          <p className="t-small muted mt-2">
            Everything below is current state, read from public sources, each one linked. Checked in {(d.ms / 1000).toFixed(1)}s.
          </p>
        </div>
      </section>

      {d.groups.map((g) => {
        const facts = g.facts.filter(isPublicFact);
        if (!facts.length) return null;
        return (
          <section key={g.module} className="mb-10">
            <SectionHead eyebrow={g.module.replace(/^\d+\.\s*/, "")} title={titleFor(g.module)} />
            <div className="card">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {facts.map((f) => (
                  <div key={f.path} className="min-w-0">
                    <dt className="t-micro muted">{factLabel(f.path)}</dt>
                    <dd className="t-body break-words" style={{ overflowWrap: "anywhere" }}>
                      {renderValue(f.value)}
                      {/* Confidence is DISCLOSED, not hidden: a parsed number is
                          weaker evidence than a published one, and saying so is
                          the difference between data and a guess. */}
                      {typeof f.confidence === "number" && f.confidence < 0.85 && (
                        <span className="t-micro muted"> · ~{Math.round(f.confidence * 100)}% confident</span>
                      )}
                    </dd>
                    {f.quote && (
                      <p className="t-micro muted mt-1" style={{ overflowWrap: "anywhere" }}>
                        “{f.quote}”
                      </p>
                    )}
                    {f.sourceUrl && (
                      <p className="t-micro mt-1" style={{ overflowWrap: "anywhere" }}>
                        <Source url={f.sourceUrl} />
                      </p>
                    )}
                  </div>
                ))}
              </dl>
            </div>
          </section>
        );
      })}

      {/* THE PAYWALL, and the honest upgrade reason. */}
      <section className="mb-10">
        <SectionHead eyebrow="History" title="What changed, and when" />
        <div className="card card-shell">
          <p className="t-body">
            This page shows what is true <strong>today</strong>. The part nobody else has is the{" "}
            <strong>time series</strong> — every price change, tier rename, licence change and new
            subdomain, with the date it happened and the page it came from.
          </p>
          <p className="t-body mt-3">
            Pricing history is back-filled from public archives, so it starts years before we
            did — one company we checked goes back to October 2017.
          </p>
          <p className="t-small muted mt-3">
            Anyone can read a pricing page today. Knowing what it said last March is the product.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a href={CHECKOUT_URL} className="btn btn-primary no-underline">See the history</a>
            <Link href="/#pricing" className="t-small no-underline">Plans from $19/mo</Link>
          </div>
        </div>
      </section>

      {d.unavailable.length > 0 && (
        <section className="mb-10">
          <SectionHead eyebrow="Coverage" title="What we could not read" />
          <div className="card card-quiet">
            <p className="t-small">
              Stated rather than hidden — a dossier with silent gaps is a lie by omission.
            </p>
            <ul className="t-small muted mt-2 list-disc pl-5">
              {d.unavailable.map((u) => (
                <li key={u.label}>
                  {u.label} — {u.reason}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <AskAbout
        className="mb-10"
        path={`/c/${domain}`}
        ask={`What has ${domain} changed recently, and what do their pricing, hiring and vendor choices suggest about where they are heading?`}
      />

      <footer className="t-small muted border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p>
          Read from public sources only. We honour robots.txt, never scrape sites that ask us not to,
          and never use LinkedIn.
        </p>
        <p className="mt-2">
          <Link href="/">{SITE_NAME}</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/terms">Terms</Link>
        </p>
      </footer>
    </>
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
