/**
 * The landing page.
 *
 * Deliberately short. The product is a dataset, and the fastest way to believe
 * a dataset is to look at it — so the page's job is to say what it is in one
 * line, hand over a search box, and get out of the way. Every number on it is
 * computed from the code that generates the pages, so none of them can drift
 * into a claim.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { HISTORY_ART, HISTORY_ART_NARROW, STEP_ART } from "@/lib/ascii";
import { SEED, comparablePairs } from "@/lib/seed";
import { ADAPTERS } from "@/lib/sources/registry";
import { isPageworthyVendor, stackIndex } from "@/lib/stack-index";
import { SEARCH_INDEX } from "@/lib/search-index";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL, abs } from "@/lib/site";
import {
  BASE_PRICE,
  CHECKOUT_READY,
  CHECKOUT_URL,
  DEAL_ENDS,
  FREE_CALLS_PER_DAY,
  LIFETIME_PAYBACK_MONTHS,
  REFUND,
  TIERS,
  dealIsOpen,
  daysUntilDeadline,
} from "@/lib/offer";
import { Faq, SectionHead, SiteFooter, ThemeToggle, WaveRule } from "./ui";
import { SearchBox } from "./search";
import { AskAbout } from "./ask";
import { JsonLd } from "./jsonld";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  // A child's openGraph REPLACES the parent's rather than merging, so the
  // image has to be named here or the root page loses its share preview.
  openGraph: {
    type: "website",
    url: "/",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

// --- Real numbers, all computed from the code that builds the pages --------

const COMPANIES = SEED.length;
const SOURCES = ADAPTERS.length;
const VENDORS = stackIndex().vendors.filter(
  (v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor),
).length;
const PAIRS = comparablePairs().length;
const PAGES = COMPANIES + VENDORS + PAIRS;

/** What a dossier actually contains. Two or three words each — this is a list, not prose. */
const READS = [
  ["Pricing", "every tier, monthly and annual"],
  ["Vendor stack", "from public DNS records"],
  ["Releases", "changelogs, versions, APIs"],
  ["Hiring", "open roles by team and city"],
  ["Security", "CVEs, posture, breaches"],
  ["Legal entity", "registry name and address"],
  ["Reliability", "incidents and time to recover"],
  ["Reviews", "app stores, registries, forums"],
] as const;

const FAQ = [
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
    q: "Why is the current state free?",
    a: (
      <>
        Because you could read their pricing page yourself. Charging for something you can get in
        a browser tab is charging for nothing. What you cannot get is what it said last March —
        that needs someone to have been watching, which is the part we sell.
      </>
    ),
  },
  {
    q: "Do you scrape G2, Capterra or Reddit?",
    a: (
      <>
        No. Those sites block automated access, and defeating a block is not something we will do
        or rent. Where a rating is published in search results we read it from there, and where we
        cannot see something the page says so instead of guessing.
      </>
    ),
  },
  {
    q: "How often does it update?",
    a: (
      <>
        Twice a day, at 00:00 and 12:00 UTC, the same for everybody. One fixed schedule means one
        timestamp you can trust rather than a per-customer cadence nobody can reason about.
      </>
    ),
  },
  {
    q: "Can an agent use this?",
    a: (
      <>
        That is the main way in. There is a REST API and an MCP server, so Claude or any agent can
        query the dataset directly. The free tier includes {FREE_CALLS_PER_DAY} calls a day with no
        card.
      </>
    ),
  },
  {
    q: "What if it is wrong?",
    a: (
      <>
        Every number links to its source, so a wrong one is checkable rather than arguable. Prices
        we could not read with confidence are marked as such instead of being filled in by a
        guess. {REFUND}
      </>
    ),
  },
];

export default function Home() {
  return (
    <>
      {/* Organization + WebSite with a SearchAction. The search action is what
          lets a search engine or an assistant query the dataset directly
          rather than only crawling whatever we happened to link. */}
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
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: `${SITE_URL}/c/{search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@type": "Dataset",
              name: `${SITE_NAME} competitor change history`,
              description: `Change history for ${COMPANIES} companies across ${SOURCES} public sources, refreshed twice daily.`,
              url: SITE_URL,
              isAccessibleForFree: true,
              creator: { "@id": `${SITE_URL}#org` },
              license: abs("/terms"),
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

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
        <nav className="mb-14 flex items-center justify-between gap-4">
          <span className="mono t-small">{SITE_NAME}</span>
          <div className="flex items-center gap-4">
            <Link href="/stack" className="t-small no-underline">Vendors</Link>
            <Link href="/compare" className="t-small no-underline">Compare</Link>
            <Link href="#pricing" className="t-small no-underline">Pricing</Link>
            <ThemeToggle />
          </div>
        </nav>

        {/* --- Hero. One claim, one line, then the search box. ------------- */}
        <header className="mb-10">
          <p className="eyebrow mb-3">Competitor change intelligence</p>
          <h1 className="t-display" style={{ maxWidth: "24ch" }}>
            Know what they changed — and what it was before.
          </h1>
          <p className="t-body muted mt-4" style={{ maxWidth: "58ch" }}>
            Pricing, vendor stack, releases, hiring and legal filings for {COMPANIES} companies,
            read from {SOURCES} public sources twice a day. Every fact links to its source.
          </p>

          <div className="mt-7" style={{ maxWidth: "30rem" }}>
            <SearchBox index={SEARCH_INDEX} />
            <p className="t-micro muted mt-2">
              {PAGES.toLocaleString("en-GB")} pages, free and without an account. Try{" "}
              <Link href="/c/linear.app">linear.app</Link>, <Link href="/stack/anthropic">Anthropic</Link>{" "}
              or <Link href="/compare">a head-to-head</Link>.
            </p>
          </div>
        </header>

        {/* --- The one picture. ------------------------------------------- */}
        <figure className="m-0 mb-4">
          <div
            className="ascii t-micro"
            aria-hidden
            style={{ color: "var(--ocean)", opacity: 0.85, overflow: "hidden" }}
          >
            {/* Two renders rather than a horizontal scroll: 108 columns of
                monospace shears badly on a phone. */}
            <span className="hidden sm:block">{HISTORY_ART}</span>
            <span className="block sm:hidden">{HISTORY_ART_NARROW}</span>
          </div>
          <figcaption className="t-micro muted mt-2">
            Time runs left to right, tracked surfaces stack upward, brightness is the recorded
            value. The seam is a change event — and the level stays higher after it.
          </figcaption>
        </figure>

        <WaveRule />

        {/* --- What a dossier holds. A list, not paragraphs. --------------- */}
        <section className="mt-14">
          <SectionHead eyebrow="what we read" title="Eight things, per company" />
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 list-none p-0 m-0">
            {READS.map(([what, how]) => (
              <li key={what} className="flex items-baseline justify-between gap-4 border-b pb-3"
                  style={{ borderColor: "var(--border)" }}>
                <span className="t-h3">{what}</span>
                <span className="t-micro muted" style={{ textAlign: "right" }}>{how}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- The moat, stated plainly. ---------------------------------- */}
        <section className="mt-16 grid gap-8 sm:grid-cols-5 items-center">
          <div className="sm:col-span-3">
            <SectionHead eyebrow="what is worth paying for" title="The present is free. The past is the product." />
            <p className="t-body muted m-0" style={{ maxWidth: "48ch" }}>
              Anyone can open a competitor&rsquo;s pricing page today. Knowing that they raised the
              middle tier 20% on a Tuesday, moved SSO to Enterprise, and did it the same week their
              hiring stopped — that needs a record. We keep the record.
            </p>
          </div>
          <div className="sm:col-span-2">
            <div className="ascii t-micro" aria-hidden style={{ color: "var(--coral)", opacity: 0.9 }}>
              {STEP_ART}
            </div>
            <p className="t-micro muted mt-2 mb-0">A tier price, before and after.</p>
          </div>
        </section>

        {/* --- Pricing. ---------------------------------------------------- */}
        <section id="pricing" className="mt-20 scroll-mt-8">
          <SectionHead eyebrow="pricing" title="Generous on companies. Priced on history." />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t) => (
              <div key={t.slug} className={t.slug === "pro" ? "card p-5" : "card-quiet p-5"}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="t-h3 m-0">{t.name}</h3>
                  {t.slug === "pro" && <span className="pill pill-strong t-micro">Most bought</span>}
                </div>
                <p className="t-h2 mt-2 mb-1">
                  {t.monthly === 0 ? "Free" : `$${t.monthly}`}
                  {t.monthly ? <span className="t-micro muted"> /mo</span> : null}
                </p>
                <p className="t-micro muted mt-0 mb-4">{t.who}</p>

                <dl className="t-small m-0 space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt className="muted">Companies</dt>
                    <dd className="m-0">{t.companies.toLocaleString("en-GB")}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="muted">History</dt>
                    <dd className="m-0">{t.history}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="muted">API + MCP</dt>
                    <dd className="m-0">{t.calls.toLocaleString("en-GB")}/day</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="muted">Seats</dt>
                    <dd className="m-0">{t.seats}</dd>
                  </div>
                </dl>

                <ul className="t-micro muted mt-4 mb-0 list-none p-0 space-y-1">
                  {t.adds.map((a) => <li key={a}>+ {a}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <LifetimeOffer />

          <p className="t-micro muted mt-4">
            Every paid tier includes the REST API and the MCP server. The free tier does too, at{" "}
            {FREE_CALLS_PER_DAY} calls a day — no card, because an agent that cannot try it will
            never buy it.
          </p>
        </section>

        {/* --- FAQ. -------------------------------------------------------- */}
        <section className="mt-20">
          <SectionHead eyebrow="before you buy" title="The questions worth asking" />
          <Faq items={FAQ} />
        </section>

        <AskAbout
          className="mt-12"
          path="/"
          ask={`What is ${SITE_NAME}, which public sources does it read, and what could I do with its API and MCP server?`}
        />

        <SiteFooter />
      </main>
    </>
  );
}

/**
 * The lifetime offer, in its own cached scope.
 *
 * It reads the clock, and Cache Components refuses an unstable value during
 * prerender — correctly, since a day counter baked into a static page would be
 * wrong by tomorrow. Caching it by the hour prerenders a real number and
 * refreshes it, which also means the block disappears by itself once the
 * deadline passes rather than relying on anyone remembering to remove it.
 */
async function LifetimeOffer() {
  "use cache";
  cacheLife("hours");

  if (!dealIsOpen()) return null;
  const daysLeft = daysUntilDeadline();

  return (
    <div className="card-mint mt-6 p-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
      <div>
        <p className="eyebrow mb-2">Lifetime</p>
        <p className="t-h2 m-0">${BASE_PRICE} once, for Pro — forever</p>
        <p className="t-small mt-2 mb-0" style={{ maxWidth: "46ch" }}>
          {LIFETIME_PAYBACK_MONTHS} months of Pro at the monthly price. The price rises $10 every
          10 sales and the offer closes on{" "}
          {DEAL_ENDS.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
          {daysLeft > 0 ? ` — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}.
        </p>
      </div>
      <div className="mt-5 sm:mt-0 shrink-0">
        <a href={CHECKOUT_URL} className="btn btn-primary no-underline">
          {CHECKOUT_READY ? "Get lifetime access" : "See the data first"}
        </a>
        <p className="t-micro mt-2 mb-0">{REFUND}</p>
      </div>
    </div>
  );
}

/**
 * Plain-text answers for the FAQPage JSON-LD.
 *
 * The visible answers are JSX, and schema.org needs strings. Rather than
 * stringify React (which would emit markup into structured data) the text is
 * written once here, keyed by question, and the keys are asserted to line up.
 */
function faqText(q: string): string {
  const TEXT: Record<string, string> = {
    "Where does the data come from?":
      `${SOURCES} public sources: company pages, public DNS, GitHub, registries, app stores, status pages and national company registries. Every fact stores the source URL and a short quote.`,
    "Why is the current state free?":
      "Because you could read their pricing page yourself. What you cannot get in a browser tab is what it said months ago, which requires having watched — and that is the paid part.",
    "Do you scrape G2, Capterra or Reddit?":
      "No. Those sites block automated access and we do not defeat blocks, directly or through a provider. Published ratings are read from search results, and gaps are disclosed rather than guessed.",
    "How often does it update?":
      "Twice a day, at 00:00 and 12:00 UTC, identically for every customer.",
    "Can an agent use this?":
      `Yes — a REST API and an MCP server, so any agent can query the dataset. The free tier includes ${FREE_CALLS_PER_DAY} calls a day without a card.`,
    "What if it is wrong?":
      `Every number links to its source. Values that could not be read with confidence are marked rather than filled in. ${REFUND}`,
  };
  return TEXT[q] ?? q;
}
