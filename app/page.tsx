/**
 * The landing page.
 *
 * It is free and open source now, so there is no price to argue for — which
 * removes the usual job of a landing page and leaves a better one: show that
 * the data is real, then get out of the way. The page is therefore built
 * around three things a visitor can do in the next ten seconds (look up a
 * company, connect an agent, read the source) rather than around persuasion.
 *
 * Every figure on it is computed from the code that generates the pages, so
 * none of them can drift into a claim.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { HISTORY_ART, HISTORY_ART_NARROW, STEP_ART } from "@/lib/ascii";
import { SEED, comparablePairs } from "@/lib/seed";
import { ADAPTERS } from "@/lib/sources/registry";
import { isPageworthyVendor, stackIndex } from "@/lib/stack-index";
import { DEPLOY_STEPS, LICENSE, REPO_URL } from "@/lib/project";
import { QUERIES } from "@/lib/queries";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL, abs } from "@/lib/site";
import { Faq, SectionHead, SiteFooter } from "./ui";
import { SiteNav } from "./nav";
import { AskAbout } from "./ask";
import { LiveCode } from "./origin";
import { JsonLd } from "./jsonld";
import { SearchBox } from "./search";
import { SEARCH_INDEX } from "@/lib/search-index";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

// --- Real numbers, computed from the code that builds the pages -----------

const COMPANIES = SEED.length;
const SOURCES = ADAPTERS.length;
const VENDORS = stackIndex().vendors.filter(
  (v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor),
).length;
const PAIRS = comparablePairs().length;
const PAGES = COMPANIES + VENDORS + PAIRS;
const TOOLS = QUERIES.length;

const READS = [
  ["Pricing", "every tier, monthly and annual"],
  ["Vendor stack", "from public DNS records"],
  ["Releases", "changelogs, versions, APIs"],
  ["Hiring", "open roles by team and city"],
  ["Security", "DMARC, CVEs, posture"],
  ["Legal entity", "registry name and country"],
  ["Reliability", "incidents and time to recover"],
  ["Reach", "rank, locales, app presence"],
] as const;

const FAQ = [
  {
    q: "Is it really free?",
    a: (
      <>
        Yes, and {LICENSE} licensed. There is no account, no key and no quota. The data is public
        records, so putting a gate on it would cost every agent that might use this and buy
        nothing in return.
      </>
    ),
  },
  {
    q: "Where does the data come from?",
    a: (
      <>
        {SOURCES} public sources — company pages, public DNS, GitHub, registries, app stores,
        status pages, national company registries. Every fact stores the URL it came from and a
        short quote, so you can check it. Nothing is behind a login and nothing is bought.
      </>
    ),
  },
  {
    q: "Do you scrape G2, Capterra or Reddit?",
    a: (
      <>
        No. Those sites block automated access, and defeating a block is not something this does
        or rents. Where a rating is published in search results it is read from there, and where
        something cannot be seen the page says so instead of guessing.
      </>
    ),
  },
  {
    q: "What does it take to run my own?",
    a: (
      <>
        Fork it and deploy. There is nothing to configure and nothing to sign up for — pages read
        public sources on request, and the API and MCP server are live immediately. Turn on the
        included schedule and it starts recording, which is how the <em>history</em> builds.
      </>
    ),
  },
  {
    q: "What if it is wrong?",
    a: (
      <>
        Every number links to its source, so a wrong one is checkable rather than arguable. Values
        that could not be read with confidence are marked, and an unresolved company identity says
        so rather than naming a plausible stranger. Found a bug? The source is right there.
      </>
    ),
  },
];

export default function Home() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE_URL}#org`,
              name: SITE_NAME,
              url: SITE_URL,
              description: SITE_DESCRIPTION,
            },
            {
              "@type": "WebSite",
              "@id": `${SITE_URL}#site`,
              url: SITE_URL,
              name: SITE_NAME,
              description: SITE_DESCRIPTION,
              publisher: { "@id": `${SITE_URL}#org` },
              potentialAction: {
                "@type": "SearchAction",
                target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/c/{search_term_string}` },
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@type": "SoftwareSourceCode",
              name: SITE_NAME,
              codeRepository: REPO_URL,
              license: "https://opensource.org/licenses/MIT",
              programmingLanguage: "TypeScript",
              description: SITE_DESCRIPTION,
            },
            {
              "@type": "Dataset",
              name: `${SITE_NAME} company records`,
              description: `Public-record facts for ${COMPANIES} companies across ${SOURCES} sources.`,
              url: SITE_URL,
              isAccessibleForFree: true,
              license: "https://opensource.org/licenses/MIT",
              creator: { "@id": `${SITE_URL}#org` },
            },
            {
              "@type": "FAQPage",
              mainEntity: FAQ.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: faqText(f.q) },
              })),
            },
          ],
        }}
      />

      <main className="mx-auto w-full max-w-5xl px-5 sm:px-6 py-6 sm:py-8">
        <SiteNav />

        {/* --- Hero. One claim, one line, then the search box. ------------- */}
        <header className="hero">
          <p className="eyebrow mb-4">
            Open source · {LICENSE} · competitor change intelligence
          </p>
          <h1 className="t-display measure-tight">
            Know what they changed — and what it was before.
          </h1>
          <p className="lede mt-5 measure">
            Pricing, vendor stack, releases, hiring and legal filings for {COMPANIES} companies,
            read from {SOURCES} public sources. Every fact links to the page it came from.
          </p>

          <div className="mt-8" style={{ maxWidth: "32rem" }}>
            <SearchHero />
          </div>

          <div className="mt-10 stats">
            <div className="stat">
              <p className="stat-n m-0">{COMPANIES}</p>
              <p className="stat-l m-0">companies tracked</p>
            </div>
            <div className="stat">
              <p className="stat-n m-0">{SOURCES}</p>
              <p className="stat-l m-0">public sources</p>
            </div>
            <div className="stat">
              <p className="stat-n m-0">{PAGES.toLocaleString("en-GB")}</p>
              <p className="stat-l m-0">pages, no account</p>
            </div>
            <div className="stat">
              <p className="stat-n m-0">{TOOLS}</p>
              <p className="stat-l m-0">MCP tools, no key</p>
            </div>
          </div>
        </header>

        {/* --- The one picture. --------------------------------------------- */}
        <figure className="band m-0">
          {/* Two renders, each sized so its exact column count fills the band.
              A fixed font-size made 108 columns of monospace overflow and the
              glyphs read as blocks instead of a gradient. */}
          <div className="ascii art-wide" aria-hidden>{HISTORY_ART}</div>
          <div className="ascii art-narrow" aria-hidden>{HISTORY_ART_NARROW}</div>
          <figcaption className="t-micro muted measure band-cap">
            Time runs left to right, tracked surfaces stack upward, brightness is the recorded
            value. The seam is a change event — and the level stays higher after it.
          </figcaption>
        </figure>

        {/* --- Three things to do right now. -------------------------------- */}
        <section className="section">
          <SectionHead eyebrow="start here" title="Three ways in" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Link href="/c/adyen.com" className="entry no-underline">
              <span className="entry-kicker">A company</span>
              <p className="entry-title">adyen.com</p>
              <p className="t-small muted mt-2 mb-0">
                Legal entity, 20 vendors, where it is registered, what it publishes for machines.
              </p>
            </Link>
            <Link href="/stack/anthropic" className="entry no-underline">
              <span className="entry-kicker">A vendor</span>
              <p className="entry-title">Who uses Anthropic</p>
              <p className="t-small muted mt-2 mb-0">
                Read from public DNS — back-office purchases that script detection cannot see.
              </p>
            </Link>
            <Link href="/compare/asana.com-vs-linear.app" className="entry no-underline">
              <span className="entry-kicker">A head-to-head</span>
              <p className="entry-title">Asana vs Linear</p>
              <p className="t-small muted mt-2 mb-0">
                Only the facts where they actually differ, out of {PAIRS} generated pairs.
              </p>
            </Link>
          </div>
        </section>

        {/* --- For agents. The differentiator, with the snippet inline. ----- */}
        <section className="section">
          <div className="grid gap-8 lg:grid-cols-5 items-start">
            <div className="lg:col-span-2">
              <SectionHead eyebrow="for agents" title="Point Claude at it" />
              <p className="t-body muted m-0 measure">
                A Model Context Protocol server with {TOOLS} tools and <strong>no authentication
                at all</strong>. No key, no account, no quota — an agent firing twenty queries to
                answer one question is the point, not a billing event.
              </p>
              <p className="t-small mt-4 mb-0">
                <Link href="/docs">Full API and MCP docs →</Link>
              </p>
            </div>
            <div className="lg:col-span-3">
              <div className="code-block">
                <p className="code-label">Claude Code</p>
                <pre className="code-pre">
                  <code>
                    <LiveCode
                      template="claude mcp add --transport http delta {ORIGIN}/api/mcp"
                      fallback={SITE_URL}
                    />
                  </code>
                </pre>
              </div>
              <p className="t-micro muted mt-3">
                Or append <code className="mono">.md</code> to any page for a clean Markdown
                version — <Link href="/c/adyen.com.md">/c/adyen.com.md</Link>. There is a{" "}
                <Link href="/skill/SKILL.md">Claude Skill</Link> and an{" "}
                <Link href="/llms.txt">llms.txt</Link> too.
              </p>
            </div>
          </div>
        </section>

        <hr className="rule" />

        {/* --- What a dossier holds. ---------------------------------------- */}
        <section className="section-tight">
          <SectionHead eyebrow="what it reads" title="Eight things, per company" />
          <ul className="grid gap-x-10 gap-y-3 sm:grid-cols-2 list-none p-0 m-0">
            {READS.map(([what, how]) => (
              <li
                key={what}
                className="flex items-baseline justify-between gap-4 border-b pb-3"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="t-h3">{what}</span>
                <span className="t-micro muted" style={{ textAlign: "right" }}>{how}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- Why history is the interesting part. ------------------------- */}
        <section className="section grid gap-8 sm:grid-cols-5 items-center">
          <div className="sm:col-span-3">
            <SectionHead eyebrow="the interesting part" title="Today is easy. Last March is not." />
            <p className="t-body muted m-0 measure">
              Anyone can open a competitor&rsquo;s pricing page right now. Knowing they raised the
              middle tier 20% on a Tuesday, moved SSO to Enterprise, and did it the same week their
              hiring stopped — that needs a record, and a record only exists if something was
              watching. Run the crawl and yours starts accruing from that day.
            </p>
          </div>
          <div className="sm:col-span-2">
            <div className="ascii t-micro" aria-hidden style={{ color: "var(--coral)", opacity: 0.9 }}>
              {STEP_ART}
            </div>
            <p className="t-micro muted mt-2 mb-0">A tier price, before and after.</p>
          </div>
        </section>

        {/* --- Self-host, as three steps rather than a dependency list. ---- */}
        <section className="section">
          <SectionHead eyebrow="run your own" title="Fork it and deploy" />
          <ol className="steps">
            {DEPLOY_STEPS.map((d, i) => (
              <li key={d.step} className="step">
                <span className="step-n" aria-hidden>{i + 1}</span>
                <div>
                  <p className="t-h3 m-0">{d.step}</p>
                  <p className="t-small muted mt-1 mb-0">{d.what}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={REPO_URL} className="btn btn-primary no-underline" rel="noopener">
              Source on GitHub →
            </a>
            <Link href="/docs" className="btn no-underline">Read the docs</Link>
          </div>
        </section>

        {/* --- FAQ. --------------------------------------------------------- */}
        <section className="section-tight">
          <SectionHead eyebrow="questions" title="The ones worth asking" />
          <Faq items={FAQ} />
        </section>

        <AskAbout
          className="section-tight"
          path="/"
          ask={`What is ${SITE_NAME}, which public sources does it read, and what could I do with its MCP server?`}
        />

        <SiteFooter />
      </main>
    </>
  );
}

/** The hero search, split out so the page body stays readable. */
function SearchHero() {
  return (
    <>
      <SearchBoxWrapper />
      <p className="t-micro muted mt-3">
        {VENDORS} vendors · {PAIRS} comparisons · free and without an account.
      </p>
    </>
  );
}

function SearchBoxWrapper() {
  return <SearchBox index={SEARCH_INDEX} />;
}

function faqText(q: string): string {
  const TEXT: Record<string, string> = {
    "Is it really free?":
      `Yes, and ${LICENSE} licensed. No account, no key, no quota. The data is public records, so gating it would cost every agent that might use it and buy nothing in return.`,
    "Where does the data come from?":
      `${SOURCES} public sources: company pages, public DNS, GitHub, registries, app stores, status pages and national company registries. Every fact stores the source URL and a short quote.`,
    "Do you scrape G2, Capterra or Reddit?":
      "No. Those sites block automated access and this does not defeat blocks, directly or through a provider. Published ratings are read from search results, and gaps are disclosed rather than guessed.",
    "What does it take to run my own?":
      "Fork it and deploy. Nothing to configure and nothing to sign up for. Turn on the included schedule and it begins recording history.",
    "What if it is wrong?":
      "Every number links to its source. Values that could not be read with confidence are marked, and an unresolved company identity says so rather than naming a plausible stranger. The source is open, so bugs are fixable.",
  };
  return TEXT[q] ?? q;
}
