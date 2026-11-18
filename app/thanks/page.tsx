import Link from "next/link";
import { FREE_ROWS } from "@/lib/offer";
import { WaveRule } from "../ui";

export const metadata = { title: "Thanks — LEDE" };

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
          <strong>2. Open the app and pick &ldquo;I have a licence&rdquo;.</strong>
          <span className="block t-small muted">
            Paste the key into section 01, along with your own Claude, Gemini or Groq key.
          </span>
        </li>
        <li>
          <strong>3. Run your real list.</strong>
          <span className="block t-small muted">
            No {FREE_ROWS}-email cap any more. Your provider bills you for usage directly, and
            we never mark it up.
          </span>
        </li>
      </ol>

      <Link href="/run" className="btn btn-primary no-underline">
        Open the app
      </Link>

      <p className="t-micro muted mt-8">
        {/* TODO before launch: real support address. Creem's account review
            requires a reachable one, and this page is where buyers look. */}
        Key not arrived, or anything else wrong? Reply to the Creem receipt and it reaches us.
      </p>
    </main>
  );
}
