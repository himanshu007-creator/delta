import Link from "next/link";
import { BASE_PRICE, REFUND, TIERS, tierBySlug } from "@/lib/offer";
import { SITE_NAME } from "@/lib/site";

export const metadata = {
  title: "Terms",
  description: `Terms of use for ${SITE_NAME} — what a licence buys, how the data is sourced, and what it is not.`,
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  const pro = tierBySlug("pro")!;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <Link href="/" className="t-small no-underline">
        ← {SITE_NAME}
      </Link>
      <h1 className="t-h2 mt-6 mb-2">Terms</h1>
      <p className="t-small muted mb-10">Last updated 19 November 2026.</p>

      <h2 className="t-h3 mb-3">What you are buying</h2>
      <p className="t-small muted mb-8">
        Access to a dataset and the tools that query it: a dashboard, a REST API and an MCP
        server. Monthly plans run from ${TIERS[1].monthly} and renew until you cancel. The
        ${BASE_PRICE} lifetime licence is a single payment that grants the {pro.name} plan and
        does not renew; it is bounded to that plan deliberately, because we carry its running
        cost indefinitely. Each plan&apos;s company count, history depth and daily call quota are
        stated on the pricing section and are the limits that apply.
      </p>

      <h2 className="t-h3 mb-3">Your licence key</h2>
      <p className="t-small muted mb-8">
        For you and your stated number of seats, not for sharing or resale. Calls are counted
        against each key, and a key that is plainly being shared more widely than its plan allows
        may be suspended. If yours leaks, tell us and we will issue a new one.
      </p>

      <h2 className="t-h3 mb-3">Fair use, and what you may do with the data</h2>
      <p className="t-small muted mb-8">
        You may use what you retrieve inside your own business — in reports, dashboards, decks and
        analysis. You may not resell or redistribute the dataset itself, in bulk or as a competing
        feed, and you may not use the API to reconstruct it wholesale. Past your plan&apos;s daily
        quota, talk to us rather than assuming either way.
      </p>

      <h2 className="t-h3 mb-3">Refunds</h2>
      <p className="t-small muted mb-8">
        {REFUND} There is also a free tier, and the public company, vendor and comparison pages
        need no account at all — so you can judge the data before you spend anything. Payments and
        refunds are processed by Creem, our merchant of record.
      </p>

      <h2 className="t-h3 mb-3">Where the data comes from</h2>
      <p className="t-small muted mb-8">
        Public records only: companies&apos; own published pages, public DNS, open APIs, package
        registries, app stores, status pages and national company registries. We honour
        robots.txt, obey rate limits, and identify ourselves with a generic user agent. We do not
        defeat bot protection or CAPTCHAs — whether by doing it ourselves or paying a provider to
        do it — and we do not access LinkedIn. Where a source is closed to us, the page says so
        rather than filling the gap with a guess.
      </p>

      <h2 className="t-h3 mb-3">What the data is, and is not</h2>
      <p className="t-small muted mb-8">
        Every fact stores the URL it came from and a short quote, so you can check it against the
        source. Values we could not read with confidence are marked rather than inferred. That
        makes errors checkable; it does not make them impossible. Companies change their pages,
        registries lag, and a parser can misread an unusual layout. Verify anything you are about
        to act on commercially against the source we link. We do not warrant that the data is
        accurate, complete, current or fit for any particular decision, and nothing here is legal,
        financial or investment advice.
      </p>

      <h2 className="t-h3 mb-3">Acceptable use</h2>
      <p className="t-small muted mb-8">
        This is a tool for understanding companies, not people. We aggregate to the company and do
        not build profiles of individuals, and you must not use the service to target, harass or
        compile information about a person. Do not use it to breach anyone&apos;s rights, to
        circumvent a third party&apos;s access controls, or for anything unlawful where you or the
        subject are located.
      </p>

      <h2 className="t-h3 mb-3">Availability</h2>
      <p className="t-small muted mb-8">
        {SITE_NAME} is run by one person and offered as is, without an uptime guarantee. Collection
        depends on other companies&apos; websites and on third-party APIs, which change, rate-limit
        and go down without warning; coverage therefore varies by company and over time. The
        refresh schedule is twice daily at 00:00 and 12:00 UTC on a best-efforts basis. Where the
        law allows, our liability is limited to what you paid in the previous twelve months.
      </p>

      <h2 className="t-h3 mb-3">Contact and governing law</h2>
      <p className="t-small muted">
        {/* TODO before launch: operator's legal name, country, support
            address and governing jurisdiction. These cannot be guessed. */}
        Operator name, country, support address and governing law to be filled in before launch.
      </p>
    </main>
  );
}
