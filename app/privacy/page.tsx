import Link from "next/link";
import { REPO_URL } from "@/lib/project";
import { SITE_NAME } from "@/lib/site";
import { SiteNav } from "../nav";
import { SiteFooter } from "../ui";

export const metadata = {
  title: "Privacy",
  description: `What ${SITE_NAME} collects, what it deliberately does not, and where it stops.`,
  alternates: { canonical: "/privacy" },
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Much shorter than it was, because there are no accounts, no payments and no
 * licence keys any more — so most of what a privacy policy usually covers
 * genuinely does not exist here. Every claim is checkable against a file: the
 * crawl is lib/sources/run.ts, the request guards are lib/fetch.ts, and the
 * store is lib/store.ts.
 */
export default function Privacy() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <SiteNav search={false} />

      <h1 className="t-h2 mt-6 mb-2">Privacy</h1>
      <p className="t-small muted mb-10">Last updated 24 November 2026.</p>

      <h2 className="t-h3 mb-3">About you: almost nothing</h2>
      <p className="t-small muted mb-8">
        There are no accounts, no sign-up, no payments and no licence keys, so there is nothing to
        collect. The public pages and the API are unauthenticated. If you pass an{" "}
        <code className="mono">x-watcher</code> value to scope a watchlist, that string is stored
        with the domains you chose — pick anything; it identifies nobody and grants nothing.
      </p>
      <p className="t-small muted mb-8">
        A hosted deployment runs Vercel Analytics and Speed Insights, which measure page
        performance and aggregate traffic. Self-host and even that is yours to remove.
      </p>

      <h2 className="t-h3 mb-3">About the companies tracked</h2>
      <p className="t-small muted mb-6">
        The dataset is built from public records: companies&apos; own published pages, public DNS,
        open APIs, package registries, app stores, status pages and national company registries.
        It stores extracted facts — numbers, dates, tier names — plus the source URL and a short
        quote. It does not republish pages wholesale.
      </p>

      <h2 className="t-h3 mb-3">Where it deliberately stops</h2>
      <p className="t-small muted mb-6">
        Some public records name individuals. This line is a design constraint, enforced in the
        code, not a policy sentence:
      </p>
      <ul className="space-y-3 mb-10">
        <li>
          <strong>Aggregated to the company, never to a person.</strong>
          <span className="block t-small muted">
            &ldquo;Three tribunal decisions in two years&rdquo;, not a claimant&apos;s name. There is no
            people search, and there will not be one.
          </span>
        </li>
        <li>
          <strong>No compiling personal information across sources.</strong>
          <span className="block t-small muted">
            An officer name is stored only where a registry publishes it as the company&apos;s own
            filed data, and is never enriched or cross-referenced. That distinction is what
            separates competitive intelligence from a surveillance product.
          </span>
        </li>
        <li>
          <strong>Never LinkedIn, never a bypassed block.</strong>
          <span className="block t-small muted">
            It honours <code className="mono">robots.txt</code>, obeys rate limits, sends a generic
            user agent, and does not defeat bot protection or CAPTCHAs — directly or through a
            provider.
          </span>
        </li>
      </ul>

      <h2 className="t-h3 mb-3">Model providers</h2>
      <p className="t-small muted mb-8">
        A small share of collection can use a language model to read an awkward page. Only the
        competitor&apos;s public page content is ever sent, never anything about you — and a
        deployment with no model key configured simply skips that step.{" "}
        <strong>Some providers&apos; free tiers train on submitted content</strong>, which is exactly
        why the boundary is drawn there.
      </p>

      <h2 className="t-h3 mb-3">Removal and contact</h2>
      <p className="t-small muted">
        If you are named in a public record this holds and want it removed, open an issue on{" "}
        <a href={REPO_URL} rel="noopener">the repository</a> and it will be taken out. The code is{" "}
        <Link href="/terms">MIT licensed</Link>, so you can also read exactly what it does.
      </p>

      <SiteFooter />
    </main>
  );
}
