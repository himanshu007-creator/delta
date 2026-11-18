import Link from "next/link";
import { BASE_PRICE, ROWS_PER_MONTH, REFUND } from "@/lib/offer";

export const metadata = { title: "Terms — LEDE" };

export default function Terms() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <Link href="/" className="t-small no-underline">
        ← LEDE
      </Link>
      <h1 className="t-h2 mt-6 mb-2">Terms</h1>
      <p className="t-small muted mb-10">Last updated 18 November 2026.</p>

      <h2 className="t-h3 mb-3">What you are buying</h2>
      <p className="t-small muted mb-8">
        One payment of ${BASE_PRICE} buys one person a licence to use LEDE, including future
        updates to the features described on the site at the time of purchase. It is not a
        subscription and does not renew. Fair use is{" "}
        {ROWS_PER_MONTH.toLocaleString()} rows a month; past that, talk to us rather than
        assuming either way.
      </p>

      <h2 className="t-h3 mb-3">Your licence key</h2>
      <p className="t-small muted mb-8">
        For you, not for sharing or resale. We count rows against each key, and a key that is
        plainly being shared may be suspended. If yours leaks, tell us and we will issue a new one.
      </p>

      <h2 className="t-h3 mb-3">Refunds</h2>
      <p className="t-small muted mb-8">
        {REFUND} You also get free emails before paying anything, so you can judge the writing
        before you spend. Refunds are processed by Creem, our merchant of record.
      </p>

      <h2 className="t-h3 mb-3">What you pay your AI provider</h2>
      <p className="t-small muted mb-8">
        LEDE runs on your own API key. Anthropic, Google or Groq bills you directly for usage
        and we add no markup, nor do we ever see those charges. Cost figures in the app are
        computed from each provider&apos;s published rates and are estimates: your provider&apos;s
        invoice is the real number. Their terms govern your use of their models.
      </p>

      <h2 className="t-h3 mb-3">You are the sender</h2>
      <p className="t-small muted mb-8">
        This is the part that matters most. LEDE writes drafts; it does not send anything. You
        decide who to contact and you are the sender of every message, which makes you
        responsible for complying with the law that applies to you and your recipients —
        including CAN-SPAM, GDPR and PECR, CASL, and any local equivalent. That typically means
        having a lawful basis to contact someone, identifying yourself honestly, and honouring
        opt-outs. Do not use LEDE for unlawful, deceptive, or harassing messages, or to contact
        people who have asked you to stop.
      </p>

      <h2 className="t-h3 mb-3">What the output is, and is not</h2>
      <p className="t-small muted mb-8">
        Every claim LEDE writes is checked against a verbatim sentence from the prospect&apos;s
        own public page, and rows that fail that check are discarded rather than handed to you.
        That makes fabrication much less likely; it does not make it impossible. Read before you
        send. We do not warrant that the output is accurate, suitable, or that it will get
        replies, and we cannot control what prospects publish about themselves.
      </p>

      <h2 className="t-h3 mb-3">Availability</h2>
      <p className="t-small muted mb-8">
        LEDE is run by one person and offered as is, without an uptime guarantee. The research
        step depends on prospects&apos; own websites, which change and go down without warning.
        Where the law allows, our liability is limited to what you paid.
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
