import Link from "next/link";
import { LICENSE, REPO_URL } from "@/lib/project";
import { SITE_NAME } from "@/lib/site";
import { SiteNav } from "../nav";
import { SiteFooter } from "../ui";

export const metadata = {
  title: "Terms",
  description: `${SITE_NAME} is free and ${LICENSE} licensed. What the data is, what it is not, and how it is collected.`,
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <SiteNav search={false} />

      <h1 className="t-h2 mt-6 mb-2">Terms</h1>
      <p className="t-small muted mb-10">Last updated 24 November 2026.</p>

      <h2 className="t-h3 mb-3">Free, and {LICENSE} licensed</h2>
      <p className="t-small muted mb-8">
        There is nothing to buy and nothing to sign. The source is{" "}
        <a href={REPO_URL} rel="noopener">on GitHub</a> under the {LICENSE} licence: use it, change
        it, run your own copy, build something else on it. No warranty, as the licence says.
      </p>

      <h2 className="t-h3 mb-3">Where the data comes from</h2>
      <p className="t-small muted mb-8">
        Public records only: companies&apos; own published pages, public DNS, open APIs, package
        registries, app stores, status pages and national company registries. It honours{" "}
        <code className="mono">robots.txt</code>, obeys rate limits, and identifies itself with a
        generic user agent. It does not defeat bot protection or CAPTCHAs — whether directly or by
        paying a provider to — and it does not touch LinkedIn. Where a source is closed, the page
        says so rather than filling the gap with a guess.
      </p>

      <h2 className="t-h3 mb-3">What the data is, and is not</h2>
      <p className="t-small muted mb-8">
        Every fact stores the URL it came from and a short quote, so you can check it against the
        source. Values that could not be read with confidence are marked rather than inferred, and
        an unresolved company identity says &ldquo;unresolved&rdquo; rather than naming a plausible
        stranger. That makes errors checkable; it does not make them impossible. Companies change
        their pages, registries lag, and a parser can misread an unusual layout.{" "}
        <strong>Verify anything you are about to act on commercially against the source linked
        beside it.</strong> Nothing here is legal, financial or investment advice.
      </p>

      <h2 className="t-h3 mb-3">Acceptable use</h2>
      <p className="t-small muted mb-8">
        This is a tool for understanding companies, not people. It aggregates to the company and
        does not build profiles of individuals; do not use it to target, harass or compile
        information about a person, to breach anyone&apos;s rights, to circumvent a third
        party&apos;s access controls, or for anything unlawful where you or the subject are
        located. If you run your own copy, those obligations are yours.
      </p>

      <h2 className="t-h3 mb-3">Availability</h2>
      <p className="t-small muted mb-8">
        The hosted copy is offered as is, with no uptime guarantee, and may change or disappear.
        Collection depends on other companies&apos; websites and on third-party APIs, which
        change, rate-limit and go down without warning, so coverage varies by company and over
        time. If you need it to keep running,{" "}
        <a href={REPO_URL} rel="noopener">deploy your own</a> — that is the point of the licence.
      </p>

      <p className="t-small muted">
        See also <Link href="/privacy">Privacy</Link>, which is short for the same reason: there
        are no accounts.
      </p>

      <SiteFooter />
    </main>
  );
}
