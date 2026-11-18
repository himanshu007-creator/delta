import Link from "next/link";
import { FREE_CALLS_PER_DAY } from "@/lib/offer";
import { SITE_NAME } from "@/lib/site";

export const metadata = {
  title: "Privacy",
  description: `How ${SITE_NAME} handles your data, how it collects public company records, and where it deliberately stops.`,
  alternates: { canonical: "/privacy" },
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim here is checkable against a file: the crawl is
 * lib/sources/run.ts, robots.txt handling and the request guards are
 * lib/fetch.ts, the store and its row-level security are lib/store.ts and
 * supabase/schema.sql, and metering is lib/usage-store.ts. If the
 * architecture changes, this page is wrong and must change with it.
 */
export default function Privacy() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <Link href="/" className="t-small no-underline">
        ← {SITE_NAME}
      </Link>
      <h1 className="t-h2 mt-6 mb-2">Privacy</h1>
      <p className="t-small muted mb-10">Last updated 19 November 2026.</p>

      <h2 className="t-h3 mb-3">About you</h2>
      <ul className="space-y-3 mb-10">
        <li>
          <strong>Your email address and licence key.</strong>
          <span className="block t-small muted">
            Held so we can authenticate you and count calls against your plan. The address is
            normalised first, so <code className="mono">h.i+tag@gmail.com</code> and{" "}
            <code className="mono">hi@gmail.com</code> are recognised as one account — which is
            how the {FREE_CALLS_PER_DAY}-call free tier is metered without a card.
          </span>
        </li>
        <li>
          <strong>Your watchlist.</strong>
          <span className="block t-small muted">
            The domains you track. These are company domains, not people. We use them to decide
            what to collect and to show you your own feed, and we do not sell or share them.
          </span>
        </li>
        <li>
          <strong>Call counts.</strong>
          <span className="block t-small muted">
            Which named query ran, when, and against which key — enough to enforce a quota and
            diagnose a fault. Not the contents of your analysis.
          </span>
        </li>
      </ul>
      <p className="t-small muted mb-10">
        We may email you about {SITE_NAME}. Every message has an unsubscribe link, and we do not
        sell or share your address.
      </p>

      <h2 className="t-h3 mb-3">About the companies we track</h2>
      <p className="t-small muted mb-6">
        The dataset is built from public records: companies&apos; own published pages, public DNS,
        open APIs, package registries, app stores, status pages and national company registries.
        We store extracted facts — numbers, dates, tier names — plus the source URL and a short
        quote. We do not republish pages wholesale.
      </p>

      <h2 className="t-h3 mb-3">Where we deliberately stop</h2>
      <p className="t-small muted mb-6">
        Some public records name individuals — company officers, for instance. This is the line we
        hold, and it is a design constraint rather than a policy sentence:
      </p>
      <ul className="space-y-3 mb-10">
        <li>
          <strong>We aggregate to the company, never to a person.</strong>
          <span className="block t-small muted">
            We publish &ldquo;three tribunal decisions in two years&rdquo;, not a claimant&apos;s
            name and case. There is no people search, and there never will be.
          </span>
        </li>
        <li>
          <strong>We do not compile personal information across sources.</strong>
          <span className="block t-small muted">
            An officer name is stored only where a registry publishes it as the company&apos;s own
            filed data. It is never enriched or cross-referenced against anything else. That
            distinction is what separates competitive intelligence from a surveillance product.
          </span>
        </li>
        <li>
          <strong>We never touch LinkedIn.</strong>
          <span className="block t-small muted">
            Scraping it is what gets accounts banned, and no feature here is worth that. We do not
            log in to anything, and we do not bypass paywalls, bot protection or CAPTCHAs.
          </span>
        </li>
      </ul>
      <p className="t-small muted mb-10">
        We honour <code className="mono">robots.txt</code>, obey rate limits, send a generic user
        agent, and never put your identity or email address in an outbound request header. If you
        are named in a public record we hold and you want it removed, ask.
      </p>

      <h2 className="t-h3 mb-3">Processors</h2>
      <ul className="space-y-3 mb-10">
        <li>
          <strong>Vercel</strong>
          <span className="block t-small muted">
            Hosting, plus Analytics and Speed Insights, which measure page performance and
            aggregate traffic.
          </span>
        </li>
        <li>
          <strong>Supabase</strong>
          <span className="block t-small muted">
            Stores accounts, licences, watchlists and the dataset. Reachable only with a
            server-side key; row-level security denies everything else.
          </span>
        </li>
        <li>
          <strong>Creem</strong>
          <span className="block t-small muted">
            Our merchant of record. They process the payment and hold the billing details. We
            never see or store your card number. We receive your email address, an order id and
            the amount.
          </span>
        </li>
        <li>
          <strong>Language model providers</strong>
          <span className="block t-small muted">
            A small share of collection needs a model to read an awkward page — currently Groq and
            Google. Only the competitor&apos;s public page content is ever sent.{" "}
            <strong>
              Google&apos;s free tier may use submitted content to improve its products
            </strong>
            , which is exactly why your data never goes there: no watchlist, no email address, no
            query of yours is sent to any model provider. If you supply your own key for
            interpretation, it stays in your browser.
          </span>
        </li>
      </ul>

      <h2 className="t-h3 mb-3">Deleting your data</h2>
      <p className="t-small muted mb-10">
        Ask and we will delete your account, email address, licence record and watchlist; a deleted
        licence cannot be used again. The company dataset is public-record information and is not
        tied to your account, so it is unaffected.
      </p>

      <h2 className="t-h3 mb-3">Contact</h2>
      <p className="t-small muted">
        {/* TODO before launch: operator's legal name, country and a real
            support address. Creem's account review requires all three, and
            this page cannot go live truthfully without them. */}
        Operator name, country and support address to be filled in before launch.
      </p>
    </main>
  );
}
