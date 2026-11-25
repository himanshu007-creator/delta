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
import { SEED, pairKey, seedFor } from "@/lib/seed";
import { factLabel, publicDomain } from "@/lib/public-dossier";
import { bigMoney, financialsOf, footprintOf, hasSecurity, hasWorkforce, identityOf, interpret, securityOf, workforceOf, type Financials, type SecurityPosture, type Signal, type Workforce } from "@/lib/interpret";
import { countryName } from "@/lib/worldmap";
import { FootprintMap, hasFootprint } from "../../footprint";
import { abs, SITE_NAME } from "@/lib/site";
import { JsonLd } from "../../jsonld";
import { SectionHead, SiteFooter } from "../../ui";
import { AskAbout } from "../../ask";
import { SiteNav } from "../../nav";
import { correlate, type Insight } from "@/lib/correlate";
import { coverageOf, coverageSummary, currencySymbol, isCurrencyCode, pricingLadderOf, type Coverage, type PricingLadder } from "@/lib/profile";

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
    alternates: {
      canonical: `/c/${domain}`,
      // Agents discover the Markdown twin from here rather than guessing.
      types: { "text/markdown": `/c/${domain}.md` },
    },
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
      <SiteNav here={"companies"} />

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
      {/* No header here: Dossier renders the real one, with the legal entity
          and positioning line. Two <h1>s is also an accessibility fault. */}
      <Dossier domain={domain} />
    </>
  );
}

function Loading() {
  return (
    <>
      {/* The fallback uses a <p>, not an <h1>. Under partial prerendering the
          shell and the streamed content both appear in the raw HTML, so an
          <h1> here would give every page two of them to a crawler. */}
      <header className="mb-10">
        <p className="eyebrow mb-2">Company intelligence</p>
        <p className="t-display muted m-0">Reading public sources…</p>
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
  const fin = financialsOf(facts);
  const sec = securityOf(facts);
  const work = workforceOf(facts);
  const insights = correlate(facts);
  const coverage = coverageOf(facts);
  const ladder = pricingLadderOf(facts);

  return (
    <>
      {/* --- Identity. Who this is, before anything is claimed about them. */}
      <header className="mb-8">
        <p className="eyebrow mb-2">Company intelligence</p>
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

      {/* --- What is NOT on this page, and why. Honest, not a paywall. */}
      <section className="mb-12">
        <div className="card card-shell p-6">
          <p className="eyebrow mb-2">What this page cannot tell you</p>
          <h2 className="t-h3 m-0">Everything above is today.</h2>
          <p className="t-body mt-2 mb-0" style={{ maxWidth: "52ch" }}>
            What moves a decision is what <strong>changed</strong> — the tier that moved, the vendor
            that appeared, the week the hiring stopped. That needs a deployment that has been
            watching, so it accrues from the day you run the crawl rather than being something you
            can look up. The code for it is in the repo.
          </p>
        </div>
      </section>

      {/* --- Coverage. What we know, what is partial, what is missing and
              why — stated before any finding, so a reader can calibrate
              everything below it. */}
      <CoverageGrid coverage={coverage} />

      {/* --- Cross-source patterns. The only place two sources are combined,
              so every one carries its counter-reading. */}
      {insights.length > 0 && (
        <section className="mb-12">
          <SectionHead
            eyebrow="patterns · two or more sources"
            title={`${insights.length} thing${insights.length === 1 ? "" : "s"} worth noticing`}
          />
          <div className="grid gap-4">
            {insights.map((i) => <InsightCard key={i.id} insight={i} />)}
          </div>
          <p className="t-micro muted mt-3">
            Each pattern rests on observations from at least two independent sources and is reported as a
            co-occurrence, never a cause. The alternative reading is shown with every one.
          </p>
        </section>
      )}

      {/* --- Filed financials. Absent for a private company, and that
              absence is stated rather than left as an empty space. */}
      <FiledFinancials fin={fin} domain={domain} factSource={source} />

      {/* --- Security exposure. Only ever about artefacts they publish. */}
      {hasSecurity(sec) && <SecuritySection sec={sec} />}

      {/* --- Hiring. What they are building, read off their own job board. */}
      {hasWorkforce(work) && (
        <HiringSection
          work={work}
          facts0={{
            newestPosting: facts.get("hiring.newest_posting")?.value ?? null,
            momentum: facts.get("hiring.momentum_ratio")?.value
              ? Number(facts.get("hiring.momentum_ratio")?.value)
              : null,
          }}
        />
      )}

      {/* --- Legal. Only ever about the registered entity we resolved. */}
      {facts.get("legal.insolvency.notices") && (
        <section className="mb-12">
          <SectionHead eyebrow="legal · insolvency register" title="Insolvency register" />
          <div className="card card-quiet">
            <p className="t-body m-0">
              {Number(facts.get("legal.insolvency.notices")?.value) > 0 ? (
                <>
                  <strong>{facts.get("legal.insolvency.notices")?.value}</strong> insolvency notice(s) in The
                  Gazette name this registered entity in the notice title.
                </>
              ) : (
                <>No insolvency notice in The Gazette names this registered entity.</>
              )}
            </p>
            <p className="t-micro muted mt-2">
              Searched against the registered legal name, and a notice counts only when it names the company
              itself — a search for a bare brand returns notices about entirely different companies.
            </p>
          </div>
        </section>
      )}

      {/* --- Ecosystem. Catalogue size is the comparable number. */}
      {facts.get("ecosystem.integrations.count") && (
        <section className="mb-12">
          <SectionHead
            eyebrow="ecosystem"
            title={`${facts.get("ecosystem.integrations.count")?.value} published integrations`}
          />
          <div className="card">
            <ul className="flex flex-wrap gap-2">
              {String(facts.get("ecosystem.integrations.sample")?.value ?? "")
                .split(",")
                .filter(Boolean)
                .slice(0, 30)
                .map((x) => <li key={x} className="chip">{x}</li>)}
            </ul>
            <p className="t-micro muted mt-3">
              Counted from integration pages in their own sitemap. Category and tag pages are excluded, so
              this is entries rather than navigation — the number a competitor can be compared against.
            </p>
          </div>
        </section>
      )}

      {/* --- Competitors, named by the company itself. */}
      {facts.get("market.competitors.named") && (
        <section className="mb-12">
          <SectionHead
            eyebrow="competitors · named by them"
            title={`They compare themselves against ${facts.get("market.competitors.named_count")?.value} companies`}
          />
          <div className="card">
            <ul className="flex flex-wrap gap-2">
              {String(facts.get("market.competitors.named")?.value ?? "")
                .split(",")
                .filter(Boolean)
                .map((name) => (
                  <li key={name} className="chip">{name}</li>
                ))}
            </ul>
            <p className="t-small muted mt-3">
              Taken from comparison pages in their own sitemap, so this is the competitor set they chose to
              name — not our opinion of who competes with them.
            </p>
            <p className="t-micro muted mt-2">
              Shown as names, not links: a URL slug is not a hostname, and guessing one would point at the
              wrong company while looking authoritative.
            </p>
          </div>
        </section>
      )}

      {/* --- The published ladder, normalised for comparison. */}
      {ladder && <PricingLadderSection ladder={ladder} />}

      {/* --- Where next. The three things someone actually does from here. */}
      <WhereNext domain={domain} />

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

      <AskAbout
        className="mb-10"
        path={`/c/${domain}`}
        ask={`What has ${domain} changed recently, and what do their pricing, hiring and vendor choices suggest about where they are heading?`}
      />

      <SiteFooter />
    </>
  );
}

/**
 * The next move, made explicit.
 *
 * From a company page there are only three useful destinations: the same
 * company compared against a rival, another company in the same market, or
 * the company's own site. Leaving a reader to find those via the back button
 * is what made every company page a dead end.
 */
/**
 * Filed financials.
 *
 * Three states, and the difference between them is the honest part:
 *
 *  - a resolved filer: real figures, each with its reporting period and the
 *    filing it came from.
 *  - several filers mention the domain and none is identifiable: shown as an
 *    unresolved lead, with no figures attached to it. Publishing the
 *    likeliest match is how a company gets another company's revenue.
 *  - no filings at all: almost every private company. Said plainly, because
 *    "no data" and "not a public filer" are different claims and a blank
 *    space makes the wrong one.
 */
function FiledFinancials({
  fin,
  domain,
  factSource,
}: {
  fin: Financials;
  domain: string;
  /** Where these facts came from, so "unknown" can name the real reason. */
  factSource: "store" | "live";
}) {
  /*
   * Not checked. Said as ignorance, not as a finding — the distinction the
   * Cloudflare bug was made of.
   */
  if (!fin.checked) {
    return (
      <section className="mb-12">
        <SectionHead eyebrow="financials" title="Not checked yet" />
        <div className="card card-quiet">
          {factSource === "store" ? (
            <>
              <p className="t-body m-0">
                The recorded history for <span className="mono">{domain}</span> was collected before this
                deployment started checking filings, so it holds no answer either way.
              </p>
              <p className="t-small muted mt-2">
                It fills in on the next scheduled crawl. Naming the real reason matters more than looking
                complete — this is not a statement that the company is private.
              </p>
            </>
          ) : (
            <>
              <p className="t-body m-0">
                We did not get a reply from the SEC filing index for <span className="mono">{domain}</span> on
                this read, so we cannot say whether it files.
              </p>
              <p className="t-small muted mt-2">
                This is our gap, not a statement about the company. Reload in a moment and it will usually
                resolve.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  // Checked, and genuinely not a filer. Now the claim is earned.
  if (fin.notAFiler) {
    return (
      <section className="mb-12">
        <SectionHead eyebrow="financials" title="No filed financials" />
        <div className="card card-quiet">
          <p className="t-body m-0">
            No US annual report names <span className="mono">{domain}</span>, so there are no reported figures
            to show.
          </p>
          <p className="t-small muted mt-2">
            This is the normal case for a private company. We publish revenue only where a regulator-filed
            document supports it — no estimates, and never a funding round reported as revenue.
          </p>
        </div>
      </section>
    );
  }

  // A filer we identified, whose figures did not arrive on this read.
  if (fin.figures.length === 0 && fin.cik) {
    return (
      <section className="mb-12">
        <SectionHead eyebrow="financials" title="Filings found, figures still loading" />
        <div className="card card-quiet">
          <p className="t-body m-0">
            <span className="mono">{domain}</span> files with the SEC as{" "}
            <span className="mono">CIK {fin.cik}</span>
            {fin.registrant ? ` (${fin.registrant})` : ""}, but the figures did not come back on this read.
          </p>
          <p className="t-small muted mt-2">
            We would rather say that than show a blank, because an empty table looks like a company with no
            revenue.
          </p>
        </div>
      </section>
    );
  }

  if (fin.figures.length === 0) {
    return (
      <section className="mb-12">
        <SectionHead eyebrow="financials" title="Filer not identified" />
        <div className="card card-quiet">
          <p className="t-body m-0">
            Several companies name <span className="mono">{domain}</span> in their own annual reports, and none
            of them could be identified as its filer.
          </p>
          <p className="t-small muted mt-2">
            Holding: <span className="mono">{fin.unresolvedCandidates}</span>. We show no figures rather than
            attach the likeliest one, because a domain is often mentioned by the companies that merely use it.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-12">
      <SectionHead
        eyebrow="financials · as filed"
        title={fin.registrant ? `${fin.registrant} reports` : "Reported financials"}
      />
      <div className="card">
        <div className="stats">
          {fin.figures.filter((x) => !x.stale).map((x) => (
            <div key={x.path} className="entry">
              <p className="t-micro muted mb-1">{x.label}</p>
              <p className="t-h2 m-0 mono">{bigMoney(x.value, x.unit)}</p>
              {x.yoyPct !== null && (
                <p
                  className="t-small m-0 mt-1"
                  /* A net LOSS shrinking is good news, so tone follows the
                     figure's sign as well as the direction of change. */
                  data-tone={(x.value < 0 ? -x.yoyPct : x.yoyPct) >= 0 ? "good" : "warn"}
                >
                  {x.yoyPct >= 0 ? "+" : ""}
                  {x.yoyPct}% year over year
                </p>
              )}
              <p className="t-micro muted mt-1">
                {x.periodEnd ? `year ended ${x.periodEnd}` : "annual"}
                {x.form ? ` · ${x.form}` : ""}
              </p>
            </div>
          ))}
        </div>

        {/* Figures from an earlier period are shown, but SEPARATELY and
            dated — never in the grid above, where a reader would compute a
            margin across two different years. */}
        {fin.mixedPeriods && (
          <div className="mt-6">
            <p className="t-micro muted mb-2">
              Last reported in an earlier period — not comparable with the figures above
            </p>
            <ul className="flex flex-wrap gap-2">
              {fin.figures.filter((x) => x.stale).map((x) => (
                <li key={x.path} className="chip">
                  {x.label}: {bigMoney(x.value, x.unit)}{" "}
                  <span className="muted">(year ended {x.periodEnd})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="t-small muted mt-4">
          Every figure is taken from the company&rsquo;s own filing as most recently reported, including
          restatements of earlier years.
          {fin.latestPeriod ? ` Latest reported period ends ${fin.latestPeriod}.` : ""}
          {fin.lastFiled ? ` Last filing read: ${fin.lastFiled}.` : ""}
          {fin.figures[0]?.periods ? ` ${fin.figures[0].periods} annual periods on file.` : ""}
        </p>
        <p className="t-micro muted mt-2">
          {fin.cik ? (
            <>
              Identified as SEC filer{" "}
              <a
                href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${fin.cik}&type=10-K`}
                rel="nofollow noopener"
                target="_blank"
                className="mono"
              >
                CIK {fin.cik}
              </a>{" "}
              because {fin.filingsMatched ?? "its"} annual report
              {fin.filingsMatched === 1 ? "" : "s"} contain {domain} — not by matching its name.
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}

/**
 * Security exposure.
 *
 * Framed carefully, because the naive reading of an advisory count is
 * backwards. A project that publishes advisories against its own code is
 * running a disclosure process; one that publishes none may simply have no
 * process. So the count is presented as disclosure activity about a named
 * package, never as a safety grade, and the two feeds are never summed —
 * the same CVE appears in both.
 */
function SecuritySection({ sec }: { sec: SecurityPosture }) {
  return (
    <section className="mb-12">
      <SectionHead eyebrow="security · public advisories" title="What has been disclosed" />
      <div className="card">
        {sec.count !== null && sec.subject && (
          <>
            <p className="t-body m-0">
              <strong>{sec.count}</strong> public advisor{sec.count === 1 ? "y" : "ies"} recorded against{" "}
              <span className="mono">{sec.subject}</span>, a package they publish.
            </p>
            {sec.bySeverity.length > 0 && (
              <ul className="flex flex-wrap gap-2 mt-3">
                {sec.bySeverity.map((x) => (
                  <li
                    key={x.severity}
                    className="chip"
                    data-tone={x.severity === "critical" || x.severity === "high" ? "warn" : undefined}
                  >
                    {x.count} {x.severity}
                  </li>
                ))}
              </ul>
            )}
            <p className="t-small muted mt-3">
              {sec.latest ? `Most recent advisory ${sec.latest}. ` : ""}
              {sec.maxCvss !== null ? `Highest CVSS ${sec.maxCvss}. ` : ""}
              An advisory describes a version range and almost always ships with its fix, so this is a
              record of disclosure — not a statement that the package is unsafe today.
            </p>
          </>
        )}

        {sec.disclosed !== null && (
          <p className="t-small muted mt-4">
            They have published <strong>{sec.disclosed}</strong> advisor{sec.disclosed === 1 ? "y" : "ies"}{" "}
            themselves for <span className="mono">{sec.disclosedSubject}</span>
            {sec.disclosedLatest ? `, most recently ${sec.disclosedLatest}` : ""}. Counted separately from the
            figure above, which covers the same CVEs from the other side.
          </p>
        )}

        {(sec.scorecard !== null || sec.dmarcPolicy) && (
          <p className="t-small muted mt-2">
            {sec.scorecard !== null ? `OpenSSF Scorecard ${sec.scorecard}/10. ` : ""}
            {sec.dmarcPolicy ? `DMARC policy: ${sec.dmarcPolicy}.` : ""}
          </p>
        )}

        <p className="t-micro muted mt-3">
          Only advisories filed against packages and repositories this company owns. We never match a
          vulnerability feed on a company&rsquo;s name — a search for one well-known vendor&rsquo;s name
          returns hundreds of unrelated products.
        </p>
      </div>
    </section>
  );
}

/**
 * Hiring.
 *
 * The open-role count alone is close to useless — nobody can act on "173
 * roles". The split is the signal: 68 sales against 67 engineering says a
 * company is in a go-to-market push, and that is a sentence a competitor can
 * plan around.
 *
 * The unclassified count is shown rather than dropped. A breakdown that hides
 * what it could not place reads as more certain than it is.
 */
function HiringSection({
  work,
  facts0,
}: {
  work: Workforce;
  /** Velocity, which lives outside the workforce view model. */
  facts0: { newestPosting: string | null; momentum: number | null };
}) {
  const total = work.functions.reduce((n, x) => n + x.count, 0) + work.unclassified;
  return (
    <section className="mb-12">
      <SectionHead
        eyebrow="hiring · their own job board"
        title={
          work.focus
            ? `${work.openRoles} open roles, concentrated in ${work.focus}`
            : `${work.openRoles} open roles`
        }
      />
      <div className="card">
        {work.functions.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {work.functions.map((x) => (
              <li key={x.name} className="chip">
                {x.count} {x.name}
              </li>
            ))}
            {work.unclassified > 0 && (
              <li className="chip muted">{work.unclassified} unclassified</li>
            )}
          </ul>
        )}

        {facts0.newestPosting && (
          <p className="t-small muted mt-4">
            Most recent posting {facts0.newestPosting}
            {facts0.momentum !== null
              ? ` — the latest month is ${facts0.momentum}× the median of the months before it`
              : ""}
            .
          </p>
        )}

        {work.seniority.length > 0 && (
          <p className="t-small muted mt-4">
            Seniority named in the title:{" "}
            {work.seniority.map((x) => `${x.count} ${x.name}`).join(", ")}.
            {work.remote ? ` ${work.remote} postings name a remote location.` : ""}
            {work.locations ? ` Across ${work.locations} locations.` : ""}
          </p>
        )}

        <p className="t-micro muted mt-3">
          Functions are inferred from each posting&rsquo;s title and team, so they are a judgement rather
          than a filing{total ? ` — ${work.unclassified} of ${total} could not be placed` : ""}. A posting
          disappearing is not evidence of a layoff: boards drop and re-add roles constantly, and a removed
          posting is also what a filled role looks like.
        </p>
      </div>
    </section>
  );
}

/**
 * One correlated pattern.
 *
 * The alternative explanation is rendered at the same weight as the claim,
 * not tucked into a tooltip. An inference whose counter-reading is hidden is
 * being presented as a finding, and this is the one part of the product that
 * combines sources rather than reporting them.
 */
function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="card" data-tone={insight.tone === "neutral" ? undefined : insight.tone}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <p className="eyebrow m-0">{insight.strength}</p>
        <span className="t-micro muted mono">{insight.evidence.length} sources</span>
      </div>
      <h3 className="t-h3 mt-1 mb-2">{insight.headline}</h3>
      <p className="t-body m-0">{insight.soWhat}</p>

      <ul className="mt-4 grid gap-1.5">
        {insight.evidence.map((e) => (
          <li key={e.label} className="t-small flex gap-2 flex-wrap">
            <span className="muted">{e.label}:</span>
            <span className="mono">{e.value}</span>
            {e.source && (
              <a href={e.source} rel="nofollow noopener" target="_blank" className="t-micro muted">
                source
              </a>
            )}
          </li>
        ))}
      </ul>

      <p className="t-small muted mt-4">
        <strong>Could also be:</strong> {insight.alternative}
      </p>
      <p className="t-micro muted mt-1">{insight.limitation}</p>
    </div>
  );
}

/**
 * Coverage.
 *
 * Rendered BEFORE any finding, because it is what makes the findings
 * readable. A page that silently omits the sections it has no data for looks
 * identical whether the company has nothing to report or we failed to read
 * it, and the reader has no way to tell which.
 */
function CoverageGrid({ coverage }: { coverage: Coverage[] }) {
  const sum = coverageSummary(coverage);
  return (
    <section className="mb-12">
      <SectionHead
        eyebrow="coverage"
        title={`${sum.available} of ${sum.total} areas fully readable`}
      />
      <div className="stats">
        {coverage.map((c) => (
          <div key={c.key} className="entry">
            <p className="t-micro muted mb-1">{c.label}</p>
            <p
              className="t-h3 m-0"
              data-tone={c.status === "available" ? "good" : c.status === "partial" ? undefined : "warn"}
            >
              {c.status === "available" ? "Available" : c.status === "partial" ? "Partial" : "Not available"}
            </p>
            <p className="t-micro muted mt-1">{c.detail}</p>
            {c.asOf && <p className="t-micro muted mono mt-1">as of {c.asOf}</p>}
          </div>
        ))}
      </div>
      <p className="t-micro muted mt-3">
        &ldquo;Not available&rdquo; means the public record does not carry it, not that the company lacks
        it. Each cell says which.
      </p>
    </section>
  );
}

/**
 * The published ladder, normalised.
 *
 * Every price is a monthly equivalent, so a tier billed annually and one
 * billed monthly can sit in the same column — comparing them raw is a real
 * bug the extractor already solves upstream. Contact-sales tiers show no
 * number, because inventing one is the most tempting fabrication in
 * competitive pricing work.
 */
function PricingLadderSection({ ladder }: { ladder: PricingLadder }) {
  const money = (minor: number) => {
    const major = minor / 100;
    return `${currencySymbol(ladder.currency)}${major % 1 === 0 ? major.toFixed(0) : major.toFixed(2)}`;
  };
  return (
    <section className="mb-12">
      <SectionHead eyebrow="pricing · normalised" title={`${ladder.tiers.length} published tiers`} />
      <div className="card">
        <table className="fact-table">
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">Monthly equivalent</th>
              <th scope="col">Basis</th>
              <th scope="col">Annual saving</th>
            </tr>
          </thead>
          <tbody>
            {ladder.tiers.map((t) => (
              <tr key={t.slug}>
                <th scope="row">{t.name}</th>
                <td className="mono">{t.monthlyMinor !== null ? money(t.monthlyMinor) : "—"}</td>
                <td>{t.perSeat ? "per seat" : t.monthlyMinor !== null ? "flat" : "contact sales"}</td>
                <td className="mono">{t.annualDiscountPct !== null ? `${t.annualDiscountPct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="t-small muted mt-3">
          Prices are monthly equivalents{isCurrencyCode(ladder.currency) ? ` in ${ladder.currency}` : ""}, so
          annually-billed and monthly-billed tiers compare directly.
          {ladder.hasCustom ? " Contact-sales tiers carry no number because none is published." : ""}
        </p>
        <p className="t-micro muted mt-2">
          Currency is what the page served us and can depend on where the read originated — it is not a claim
          about their home currency.
          {ladder.basis ? ` Read from ${ladder.basis.replace("-", " ")}.` : ""}
        </p>
      </div>
    </section>
  );
}

function WhereNext({ domain }: { domain: string }) {
  const seed = seedFor(domain);
  if (!seed) {
    // Not in the seed set, so there is no category to suggest rivals from.
    // Offer the directory rather than inventing comparisons.
    return (
      <section className="mb-12">
        <SectionHead eyebrow="where next" title="Keep looking" />
        <div className="flex flex-wrap gap-3">
          <Link href="/c" className="btn no-underline">Browse all companies</Link>
          <Link href="/stack" className="btn no-underline">Browse by vendor</Link>
          <a href={`https://${domain}`} className="btn no-underline" rel="nofollow noopener" target="_blank">
            Visit {domain} →
          </a>
        </div>
      </section>
    );
  }

  const rivals = SEED.filter((c) => c.category === seed.category && c.domain !== domain).slice(0, 6);

  return (
    <section className="mb-12">
      <SectionHead eyebrow="where next" title={`Compare ${seed.name} with a rival`} />
      <div className="flex flex-wrap gap-2">
        {rivals.map((r) => {
          const slug = pairKey(domain, r.domain);
          return slug ? (
            <Link key={r.domain} href={`/compare/${slug}`} className="chip no-underline">
              vs {r.name}
            </Link>
          ) : null;
        })}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/c" className="btn no-underline">All companies</Link>
        <Link href="/stack" className="btn no-underline">Browse by vendor</Link>
        <a href={`https://${domain}`} className="btn no-underline" rel="nofollow noopener" target="_blank">
          Visit {domain} →
        </a>
      </div>
    </section>
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
