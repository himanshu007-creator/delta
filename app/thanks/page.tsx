import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { WaveRule } from "../ui";

export const metadata = {
  title: "Thanks",
  description: "Your licence key is on its way.",
  // Nothing to gain from indexing a post-payment page, and it should not
  // surface in search above the pages that actually sell.
  robots: { index: false, follow: false },
};

/**
 * Where Creem's success_url lands.
 *
 * The licence key is NOT in the redirect: Creem's docs say that when a
 * success URL is set the key is not shown on the confirmation page, and it
 * arrives by email and in the checkout.completed webhook instead. So this
 * page's job is to say where to look, not to show a key it does not have.
 */
export default function Thanks() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-16">
      <p className="eyebrow mb-3">payment received</p>
      <h1 className="t-display mb-5">That&apos;s it. You&apos;re in.</h1>

      <p className="t-body mb-8">
        Your licence key is on its way by email from Creem. It looks like{" "}
        <code className="mono">ABCDE-FGHIJ-KLMNO-PQRST-UVWXY</code>.
      </p>

      <WaveRule />

      <ol className="my-8 space-y-5">
        <li>
          <strong>1. Find the email.</strong>
          <span className="block t-small muted">
            From Creem, with your receipt and the key. Check spam if it isn&apos;t there in a
            couple of minutes.
          </span>
        </li>
        <li>
          <strong>2. Build your watchlist.</strong>
          <span className="block t-small muted">
            Add the companies you want tracked. They are collected on the next window — 00:00 or
            12:00 UTC — and back-filled from the archives after that, so history shows up without
            you waiting for it.
          </span>
        </li>
        <li>
          <strong>3. Or skip the dashboard entirely.</strong>
          <span className="block t-small muted">
            Send the key as a bearer token to the REST API, or point an MCP client at the server
            and ask Claude directly. Same data, same quota, no UI in the way.
          </span>
        </li>
      </ol>

      <div className="flex flex-wrap gap-3">
        <Link href="/stack" className="btn btn-primary no-underline">
          Browse the dataset
        </Link>
        <Link href="/compare" className="btn no-underline">
          Compare two companies
        </Link>
      </div>

      <p className="t-micro muted mt-8">
        {/* TODO before launch: real support address. Creem's account review
            requires a reachable one, and this page is where buyers look. */}
        Key not arrived, or anything else wrong? Reply to the Creem receipt and it reaches us.
      </p>

      <p className="t-micro muted mt-3">
        Thank you — genuinely. {SITE_NAME} is run by one person, and a paid licence is what keeps
        the crawl running.
      </p>
    </main>
  );
}
