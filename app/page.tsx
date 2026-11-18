import Link from "next/link";
import { abs, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { JsonLd } from "./jsonld";
import { COMPETITOR_RATES, getModel, costUsd, CHEAPEST_MODEL_ID, DEFAULT_MODEL_ID } from "@/lib/pricing";
import { renderReceipt } from "@/lib/receipt";
import { ART } from "@/lib/art";
import {
  CHECKOUT_URL,
  BASE_PRICE,
  SALES_PER_STEP,
  STEP,
  AFTER_PRICE,
  ROWS_PER_MONTH,
  REFUND,
  COMPARISON,
  DEAL_ENDS,
  priceAfterSales,
} from "@/lib/offer";
import { FREE_ROWS_PER_USER } from "@/lib/usage-store";
import { ThemeToggle, WaveRule, Scene, SectionHead, Faq, Countdown } from "./ui";

/** Computed from published rates, never asserted. */
const cheapest = getModel(CHEAPEST_MODEL_ID)!;
const free = getModel(DEFAULT_MODEL_ID)!;
const PER_ROW = costUsd({ inputTokens: 3000, outputTokens: 120 }, cheapest);

const SAMPLE = renderReceipt({
  rowsTotal: 10000,
  rowsWritten: 6210,
  rowsSkipped: 3790,
  modelId: cheapest.id,
  usage: { inputTokens: 18_630_000, outputTokens: 745_200 },
  costUsd: PER_ROW * 10000,
});

const PROVIDER_NAME: Record<string, string> = {
  groq: "Groq",
  anthropic: "Anthropic",
  google: "Google",
};

export default function Home() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              name: SITE_NAME,
              url: abs("/"),
              description: SITE_DESCRIPTION,
            },
            {
              "@type": "SoftwareApplication",
              name: SITE_NAME,
              applicationCategory: "BusinessApplication",
              description: SITE_TAGLINE,
              url: abs("/"),
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free tier: 3 tracked companies" },
            },
          ],
        }}
      />
<main className="mx-auto w-full max-w-6xl px-5 py-8">
      <nav className="flex items-center justify-between mb-14">
        <span className="t-h3 mono" style={{ letterSpacing: "0.12em" }}>
          LEDE
        </span>
        <div className="flex items-center gap-3">
          <a href="#pricing" className="t-small no-underline hidden sm:inline">
            Pricing
          </a>
          <ThemeToggle />
          <Link href="/run" className="btn btn-primary no-underline">
            Try it free
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center mb-10">
        <div>
          <p className="eyebrow mb-3">a concierge for cold email</p>
          <h1 className="t-display mb-5">
            Every email reads
            <br />
            like someone looked.
          </h1>
          <p className="t-body mb-7" style={{ maxWidth: "34rem" }}>
            Because something did. LEDE reads each prospect&apos;s site, finds one true, recent
            thing, and writes an email around it. If there&apos;s nothing worth saying, it says so
            instead of making something up.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/run" className="btn btn-primary no-underline">
              Write {FREE_ROWS_PER_USER} free emails
            </Link>
            <span className="t-small muted">On our key. No card, no API key.</span>
          </div>
        </div>
        <Scene art={ART.hero} priority sizes="(max-width: 1024px) 88vw, 40vw" />
      </section>

      <WaveRule drift />

      {/* ── Proof ───────────────────────────────────────────────── */}
      <section className="py-14">
        <SectionHead eyebrow="what it writes" title="Specific, or it tells you" />
        <div className="grid gap-5 lg:grid-cols-2">
          <article className="card-shell p-5">
            <p className="t-micro mono mb-3" style={{ opacity: 0.7 }}>
              EVERY OTHER AI TOOL
            </p>
            <p className="t-body">
              &ldquo;I came across your website and love what you&apos;re doing in the space. Would
              you be open to a quick call?&rdquo;
            </p>
          </article>
          <article className="card-mint p-5">
            <p className="t-micro mono mb-3" style={{ opacity: 0.7 }}>
              LEDE
            </p>
            <p className="t-body mb-3">
              &ldquo;You moved a billion dollars of vendor payments onto Global Payouts this year.
              That scale usually breaks reconciliation before it breaks payments.&rdquo;
            </p>
            <p className="t-small mono" style={{ opacity: 0.75 }}>
              ↳ quoted from their /blog, linked in the app
            </p>
          </article>
        </div>
        <p className="t-small muted mt-5" style={{ maxWidth: "46rem" }}>
          Every line shows the sentence it came from. If the quote isn&apos;t on their page word for
          word, the row is thrown away instead of handed to you.
        </p>
      </section>

      <WaveRule />

      {/* ── The concierge idea ──────────────────────────────────── */}
      <section className="py-14 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        {/* order- so the heading leads when this stacks on a phone. */}
        <Scene art={ART.lei} className="order-2 lg:order-1" />
        <div className="order-1 lg:order-2">
          <SectionHead eyebrow="why it reads human" title="A concierge notices one thing" />
          <p className="t-body mb-4" style={{ maxWidth: "36rem" }}>
            In Hawaii the lei is a welcome made for one guest. That&apos;s the whole idea here. A
            concierge doesn&apos;t greet a thousand people at once; they notice something about you
            and act on it.
          </p>
          <p className="t-body mb-4" style={{ maxWidth: "36rem" }}>
            So LEDE would rather hand you 6,000 real emails than 10,000 with invented details in
            them. Skipping is the premium behaviour, not a limitation.
          </p>
          <p className="t-small muted" style={{ maxWidth: "36rem" }}>
            It also strips the tells: no em dashes, no hype words, no &ldquo;I came across your
            website&rdquo;, no exclamation marks, and nothing that just repeats their own tagline
            back at them.
          </p>
        </div>
      </section>

      <WaveRule />

      {/* ── Cost ────────────────────────────────────────────────── */}
      <section className="py-14 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <SectionHead eyebrow="what it costs to run" title="Pennies, not thousands" />
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="w-full t-small">
              <thead>
                <tr className="muted">
                  <th className="text-left p-3 font-normal">Per contact</th>
                  <th className="text-right p-3 font-normal">Each</th>
                  <th className="text-right p-3 font-normal">10,000</th>
                </tr>
              </thead>
              <tbody>
                {COMPETITOR_RATES.map((c) => (
                  <tr key={c.name} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="p-3">{c.name}</td>
                    <td className="p-3 text-right mono">${c.perContactUsd.toFixed(4)}</td>
                    <td className="p-3 text-right mono">
                      ${(c.perContactUsd * 10000).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--ocean)" }}>
                  <td className="p-3" style={{ color: "var(--ocean)", fontWeight: 600 }}>
                    Your own key
                  </td>
                  <td className="p-3 text-right mono" style={{ color: "var(--ocean)" }}>
                    ${PER_ROW.toFixed(4)}
                  </td>
                  <td className="p-3 text-right mono" style={{ color: "var(--ocean)" }}>
                    ${(PER_ROW * 10000).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="t-micro muted mt-3">
            Start free on {free.label}. {cheapest.label} via{" "}
            {PROVIDER_NAME[cheapest.provider] ?? cheapest.provider} is cheapest at volume. We take no
            markup, ever.
          </p>
        </div>

        <div className="card p-4" style={{ overflowX: "auto" }}>
          <pre className="receipt" style={{ color: "var(--ocean)" }}>
            {SAMPLE}
          </pre>
          <p className="t-micro muted mt-3">
            Every run ends with a receipt. Token counts are your provider&apos;s own numbers.
          </p>
        </div>
      </section>

      <WaveRule />

      {/* ── Price ───────────────────────────────────────────────── */}
      <section className="py-14" id="pricing">
        <SectionHead eyebrow="pricing" title="Pay once. The price rises as it sells." />

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="card p-7">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="t-display">${BASE_PRICE}</span>
              <span className="t-small muted">once</span>
            </div>
            <p className="t-small muted mb-5">Not per month. Not per seat. Not per contact.</p>

            <ul className="t-small space-y-2 mb-6">
              <li>Unlimited runs, up to {ROWS_PER_MONTH.toLocaleString()} rows a month</li>
              <li>Claude, Gemini or Groq, your key either way</li>
              <li>A licence key that unlocks the research engine</li>
              <li>Your provider bills you for usage. We never mark it up.</li>
              <li>Every future update to what&apos;s here</li>
              <li>{REFUND}</li>
            </ul>

            <a href={CHECKOUT_URL} className="btn btn-primary no-underline">
              Get lifetime access
            </a>
            <p className="t-micro muted mt-3">
              {FREE_ROWS_PER_USER} free emails first, on our key. No card.
            </p>

            <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
              <p className="t-micro muted">
                The ladder: every {SALES_PER_STEP} sales the price rises ${STEP}, so early buyers get
                the best price. The lifetime deal closes in{" "}
                <Countdown to={DEAL_ENDS.toISOString()} />, after which it becomes $
                {AFTER_PRICE}/mo. Next rung: ${priceAfterSales(SALES_PER_STEP)}.
              </p>
            </div>
          </div>

          <div className="card p-6">
            <p className="eyebrow mb-3">the maths</p>
            <p className="t-small muted mb-4">
              {COMPARISON.contacts.toLocaleString()} contacts, personalised once.
            </p>
            <table className="w-full t-small mb-4">
              <tbody>
                {COMPARISON.rows.map((r) => (
                  <tr key={r.name} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-3">
                      {r.name}
                      <span className="block t-micro muted">{r.note}</span>
                    </td>
                    <td className="py-3 text-right mono">
                      {r.perContact
                        ? `$${(r.perContact * COMPARISON.contacts).toLocaleString()}`
                        : `$${r.monthly}/mo`}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-3" style={{ color: "var(--ocean)", fontWeight: 600 }}>
                    LEDE
                    <span className="block t-micro muted">${BASE_PRICE} once + your own key</span>
                  </td>
                  <td
                    className="py-3 text-right mono"
                    style={{ color: "var(--ocean)", fontWeight: 600 }}
                  >
                    ${BASE_PRICE} + ${(PER_ROW * COMPARISON.contacts).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="t-micro muted">{COMPARISON.disclaimer}</p>
          </div>
        </div>
      </section>

      <WaveRule />

      {/* ── Security ────────────────────────────────────────────── */}
      <section className="py-14 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <SectionHead eyebrow="security" title="Your key stays your key" />
          <ul className="space-y-4" style={{ maxWidth: "34rem" }}>
            <li>
              <strong>It never reaches our servers.</strong>
              <span className="block t-small muted">
                Generation runs in your browser and talks to your provider directly. Open the network
                tab and check.
              </span>
            </li>
            <li>
              <strong>Your list stays on your machine.</strong>
              <span className="block t-small muted">
                Parsed in the browser, stored locally so a closed tab doesn&apos;t lose a run.
                &ldquo;Clear all data&rdquo; genuinely deletes it.
              </span>
            </li>
            <li>
              <strong>We only ever fetch public pages.</strong>
              <span className="block t-small muted">
                Our server reads prospects&apos; public websites and respects robots.txt. It never
                touches LinkedIn, which is what gets accounts banned.
              </span>
            </li>
            <li>
              <strong>You see the cost before and after.</strong>
              <span className="block t-small muted">
                Token counts on every receipt are your provider&apos;s own numbers, not our
                estimates.
              </span>
            </li>
          </ul>
        </div>
        <Scene art={ART.palm} />
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section className="py-10">
        <SectionHead eyebrow="before you buy" title="The questions worth asking" />
        <Faq
          items={[
            {
              q: `What do I get for free?`,
              a: (
                <>
                  {FREE_ROWS_PER_USER} emails on our key, so you can see real output on your own
                  prospects without signing up for an API key first. After that, buy once for unlimited
                  runs on your own key. There is no card at any point before you choose to pay.
                </>
              ),
            },
            {
              q: "Does this sound like AI?",
              a: (
                <>
                  It is AI, and we won&apos;t pretend otherwise. What makes it read human is that
                  every claim comes from a sentence on the prospect&apos;s own site rather than from
                  the model&apos;s imagination, and the usual tells are removed in code, not merely
                  discouraged in a prompt. You see the source sentence next to every email, so you
                  can check it yourself before anything is sent.
                </>
              ),
            },
            {
              q: "Why does the price keep going up?",
              a: (
                <>
                  It&apos;s a ladder: every {SALES_PER_STEP} sales the price rises ${STEP}. Early
                  buyers get the best price. The deal closes for good on 16 December 2026, after
                  which it becomes ${AFTER_PRICE}/mo.
                </>
              ),
            },
            {
              q: "What if I don't like it?",
              a: (
                <>
                  {REFUND} You also get {FREE_ROWS_PER_USER} emails before paying anything, so you
                  should already know whether the writing is good.
                </>
              ),
            },
            {
              q: "Where does my API key go?",
              a: (
                <>
                  Into your browser&apos;s local storage, and from there straight to your provider.
                  It never reaches our servers. The free tier is the one exception, and it runs on
                  our key, server-side, precisely so no key is ever exposed in a browser.
                </>
              ),
            },
            {
              q: "Why does it skip rows?",
              a: (
                <>
                  Because some sites say nothing specific. A run of 10,000 might return 6,000
                  emails. Skipped rows are still exported, just kept out of your sending tool, where
                  a blank variable mid-sequence is worse than an absent lead.
                </>
              ),
            },
            {
              q: "Does it send the email?",
              a: (
                <>
                  No, deliberately. You already have Instantly, Smartlead or Lemlist with warmed
                  domains. We export a file shaped for each of them, and can open a prefilled draft
                  in Gmail or Outlook for one-offs.
                </>
              ),
            },
            {
              q: "How is this different from the AI in Gmail?",
              a: (
                <>
                  Gmail&apos;s writer can polish your sentence but knows nothing about the person
                  receiving it. It can&apos;t read their site, can&apos;t act on something they
                  published last week, and can&apos;t do it ten thousand times. Writing is the easy
                  part; the research is the product.
                </>
              ),
            },
            {
              q: "Who built this?",
              a: (
                <>
                  {/* TODO before launch: real name, support email, social link.
                      Creem's account review requires a reachable support address. */}
                  A solo builder, shipping in public. Support contact goes here before launch.
                </>
              ),
            },
          ]}
        />
      </section>

      {/* ── Final CTA ───────────────────────────────────────────── */}
      <section className="py-14 text-center">
        <h2 className="t-h2 mb-3">Write {FREE_ROWS_PER_USER} and see.</h2>
        <p className="t-small muted mb-6">
          No card, no API key, no signup beyond an email address.
        </p>
        <Link href="/run" className="btn btn-primary no-underline">
          Start free
        </Link>
        <p className="t-micro muted mt-4">
          One payment · Your own key · {REFUND}
        </p>
      </section>

      <footer className="t-micro muted py-10" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="mb-1">
          LEDE reads public web pages and respects robots.txt. It does not touch LinkedIn.
        </p>
        <p className="mb-1">Your key and your list stay in your browser.</p>
        <p className="mb-3">
          Art: Unsplash photographs rendered through ASCII Magic. Credits in{" "}
          <code>public/art/CREDITS.md</code>.
        </p>
        <p className="flex flex-wrap gap-4">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="#pricing">Pricing</a>
        </p>
      </footer>
    </main>
    </>
  );
}
