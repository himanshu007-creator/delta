/**
 * The scoring thesis, asserted.
 *
 * The whole product rests on one claim: a dated post or an open role is worth
 * more than a hero tagline. If that ordering ever inverts, LEDE quietly goes
 * back to writing the same generic lines as every other AI tool, and nothing
 * else in the test suite would notice.
 *
 * Run: npx tsx lib/signals.test.ts
 */

import assert from "node:assert/strict";
import { buildSignal, rankSignals, classify, extractStructured, scoreSignal } from "./signals";
import { extractSentences, extractRoles } from "./research";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// --- Ranking: recency and hiring must beat positioning ---------------------
{
  const signals = [
    buildSignal("We are building the tools for a new era of product development.", "https://x.com/about", "positioning"),
    buildSignal("Our platform helps teams move faster and work smarter together.", "https://x.com/", "positioning"),
    buildSignal("We moved $1B in vendor payments to Global Payouts last quarter.", "https://x.com/blog", "recent", iso(5)),
    buildSignal("They are currently hiring for: Account Executive, Solutions Engineer.", "https://x.com/careers", "hiring"),
  ];

  const ranked = rankSignals(signals, 4);
  assert.equal(ranked[0].type, "recent", "a fresh dated post must rank first");
  assert.ok(
    ranked.findIndex((s) => s.type === "hiring") < ranked.findIndex((s) => s.type === "positioning"),
    "hiring must outrank hero copy",
  );
  assert.equal(ranked.at(-1)!.type, "positioning", "tagline copy must rank last");
}

// --- Recency decays, and stale is penalised --------------------------------
{
  const mk = (days: number) =>
    scoreSignal({ text: "We shipped a new billing engine for enterprise teams.", type: "recent", sourceUrl: "https://x.com/blog", date: iso(days) });

  assert.ok(mk(3) > mk(30), "3 days old must beat 30");
  assert.ok(mk(30) > mk(120), "30 days old must beat 120");
  assert.ok(mk(900) < mk(120), "a two-year-old post must be penalised");
}

// --- Content can promote a sentence above its page ------------------------
{
  assert.equal(classify("We serve more than 50,000 companies worldwide today.", "positioning"), "metric");
  assert.equal(classify("Trusted by Figma, Ramp and Vercel for billing.", "positioning"), "customer");
  assert.equal(classify("We're looking for a Staff Engineer in Berlin.", "positioning"), "hiring");

  // Careers pages are mostly culture copy. "Keep the team small" is a value,
  // not a hiring trigger, and quoting it as one produces a strange email.
  assert.equal(classify("Keep the team small, do more with less.", "hiring"), "positioning");
}

// --- A question is not a signal -------------------------------------------
{
  const q = scoreSignal({ text: "What should I expect during the hiring process?", type: "hiring", sourceUrl: "https://x.com/careers" });
  const a = scoreSignal({ text: "We are opening a second office in Lisbon this year.", type: "hiring", sourceUrl: "https://x.com/careers" });
  assert.ok(q < a, "FAQ headings must sink below real statements");
}

// --- Structured extraction -------------------------------------------------
{
  const html = `<html><head>
    <meta name="description" content="We ship refurbished centrifuges to research teams worldwide.">
    <script src="https://cdn.shopify.com/s/files/app.js"></script>
    <script src="https://js.stripe.com/v3"></script>
    <script type="application/ld+json">
      {"@type":"Organization","foundingDate":"2015-04-01","numberOfEmployees":{"value":"120"}}
    </script>
  </head><body>
    <time datetime="2026-02-03T10:00:00Z">Feb 3</time>
    <p>Posted on November 5, 2026 by the team.</p>
  </body></html>`;

  const st = extractStructured(html);
  assert.ok(st.tech.includes("Shopify"), "tech must be detected from script src");
  assert.ok(st.tech.includes("Stripe"));
  assert.equal(st.foundingDate, "2015-04-01");
  assert.equal(st.employees, "120");
  assert.ok(st.description?.startsWith("We ship refurbished"), "meta description must be read");
  // Prose dates are how most blogs actually print them.
  assert.equal(st.latestDate, "2026-11-05", `got ${st.latestDate}`);
}

// --- Extraction defects that reached customers' emails ---------------------
{
  // Inline children used to glue together: "with lessWe build better".
  const glued = `<main><li><span>08.</span><h3>Keep the team small</h3><p>We build better with fewer people on every single team.</p></li></main>`;
  const out = extractSentences(glued, "https://x.com/careers").map((s) => s.text);
  assert.ok(!out.some((t) => /lessWe|smallWe/.test(t)), `inline text must not glue: ${JSON.stringify(out)}`);
  assert.ok(!out.some((t) => t.startsWith("08.")), "list markers are layout, not sentence");

  // The cookie filter was unanchored — real sentences were being destroyed.
  const food = `<main><p>Our cookie dough ships frozen to over 400 stores across the country.</p>
    <p>This site uses cookies to improve your experience and analyse traffic here.</p></main>`;
  const texts = extractSentences(food, "https://x.com/").map((t) => t.text);
  assert.ok(texts.some((t) => /cookie dough ships frozen/.test(t)), "a real cookie sentence must survive");
  assert.ok(!texts.some((t) => /uses cookies to improve/.test(t)), "the banner must still be dropped");
}

// --- Role extraction -------------------------------------------------------
{
  const careers = `<main>
    <a href="/j/1">Account Executive, Enterprise Learn more→</a>
    <a href="/j/2">Solutions Engineer</a>
    <a href="/blog">Developer blog</a>
    <a href="/faq">What should I expect during the hiring process?</a>
    <a href="/t">We are a small team that cares about our customers</a>
  </main>`;
  const roles = extractRoles(careers);
  assert.ok(roles.includes("Solutions Engineer"));
  assert.ok(roles.some((r) => r.startsWith("Account Executive")), `got ${JSON.stringify(roles)}`);
  assert.ok(!roles.some((r) => /Learn more/i.test(r)), "the card CTA must be stripped from the title");
  assert.ok(!roles.includes("Developer blog"), "a nav link that contains a role word is not a role");
  assert.ok(!roles.some((r) => r.endsWith("?")), "an FAQ question is not a role");
}

console.log("✓ signal extraction, classification and ranking all hold");
