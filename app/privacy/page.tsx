import Link from "next/link";
import { FREE_ROWS } from "@/lib/offer";

export const metadata = { title: "Privacy — LEDE" };

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim here is checkable against a file: the key never leaving the
 * browser is app/run/page.tsx, the research proxy is app/api/research/route.ts,
 * and the free-tier metering is lib/usage-store.ts. If the architecture
 * changes, this page is wrong and must change with it.
 */
export default function Privacy() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <Link href="/" className="t-small no-underline">
        ← LEDE
      </Link>
      <h1 className="t-h2 mt-6 mb-2">Privacy</h1>
      <p className="t-small muted mb-10">Last updated 18 November 2026.</p>

      <h2 className="t-h3 mb-3">What never reaches us</h2>
      <ul className="space-y-3 mb-10">
        <li>
          <strong>Your API key.</strong>
          <span className="block t-small muted">
            Stored in your browser and sent straight to Anthropic, Google or Groq. It is never
            transmitted to our servers. Open your network tab and check.
          </span>
        </li>
        <li>
          <strong>Your lead list.</strong>
          <span className="block t-small muted">
            Your CSV or Excel file is parsed in your browser and kept in IndexedDB on your own
            machine so a closed tab does not lose a run. Names, titles and email addresses in
            that file are never uploaded. &ldquo;Clear all data&rdquo; deletes it for real.
          </span>
        </li>
        <li>
          <strong>The emails we write.</strong>
          <span className="block t-small muted">
            Generated in your browser. We never see the finished text.
          </span>
        </li>
      </ul>

      <h2 className="t-h3 mb-3">What does reach us</h2>
      <ul className="space-y-3 mb-10">
        <li>
          <strong>Prospect website addresses.</strong>
          <span className="block t-small muted">
            Only the domains, so our server can fetch those public pages. A browser cannot fetch
            them itself, which is the only reason this step is ours at all.
          </span>
        </li>
        <li>
          <strong>Your licence key.</strong>
          <span className="block t-small muted">
            Sent with each research request so we can check it and count rows against it.
          </span>
        </li>
        <li>
          <strong>Your email address, if you use the free tier.</strong>
          <span className="block t-small muted">
            Needed to count your {FREE_ROWS} free emails. It is normalised first, so{" "}
            <code className="mono">h.i+tag@gmail.com</code> and{" "}
            <code className="mono">hi@gmail.com</code> are recognised as one address. On the
            free tier only, generation happens on our server using our own key, so the text we
            write for you does pass through it.
          </span>
        </li>
      </ul>
      <p className="t-small muted mb-10">
        We may email you about LEDE. Every message has an unsubscribe link, and we do not sell
        or share your address.
      </p>

      <h2 className="t-h3 mb-3">How we read prospects&apos; sites</h2>
      <p className="t-small muted mb-10">
        We fetch public pages only, and we respect <code className="mono">robots.txt</code>. We
        send a generic user agent and never put your identity or email address in a request
        header. We never touch LinkedIn: scraping it is what gets accounts banned, and no
        feature here is worth that. We do not log in to anything, and we do not bypass paywalls
        or access controls.
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
            Stores licence keys and free-tier counts. Reachable only with a server-side key;
            row-level security denies everything else.
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
          <strong>Your AI provider</strong>
          <span className="block t-small muted">
            On the paid path your browser talks to Anthropic, Google or Groq directly under your
            own account, so their privacy terms govern that exchange, not ours.
          </span>
        </li>
      </ul>

      <h2 className="t-h3 mb-3">Deleting your data</h2>
      <p className="t-small muted mb-10">
        Everything held on your machine goes with &ldquo;Clear all data&rdquo; in the app, or by
        clearing site data in your browser. To remove your email address and licence record from
        our database, ask and we will delete them; a deleted licence cannot be used again.
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
