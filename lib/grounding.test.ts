/**
 * The one check that matters.
 *
 * LEDE's entire claim is "every line quotes something really on the site, and
 * the cost we report is the cost you paid". If either breaks, the product is
 * a lie. Run with:  npx tsx lib/grounding.test.ts
 */

import assert from "node:assert/strict";
import { verifyQuote, isFiller, normalizeForCompare } from "./grounding";
import { extractSentences } from "./research";
import { costUsd, comparisonFor, getModel, DEFAULT_MODEL_ID, CHEAPEST_MODEL_ID } from "./pricing";
import { parseJsonLoose } from "./providers";
import type { Sentence } from "./research";

const src = (texts: string[]): Sentence[] => texts.map((t) => ({ text: t, sourceUrl: "https://example.com/" }));

const SENTENCES = src([
  "We ship refurbished laboratory centrifuges to research teams in over forty countries each year.",
  "Our calibration service is carried out by technicians trained on the original manufacturer equipment.",
]);

// --- Grounding: the anti-hallucination guarantee ---------------------------
{
  // Verbatim quote is accepted.
  const ok = verifyQuote(
    "We ship refurbished laboratory centrifuges to research teams in over forty countries each year.",
    "Shipping refurbished centrifuges to forty countries means your calibration turnaround is a logistics problem, not a lab one.",
    SENTENCES,
  );
  assert.equal(ok.ok, true, "verbatim quote must verify");
  assert.ok(ok.ok && ok.sourceUrl === "https://example.com/", "must return the citing page");

  // Whitespace and curly-quote differences are NOT fabrication.
  const normalized = verifyQuote(
    "Our calibration service is carried out by   technicians trained on the original\nmanufacturer equipment.",
    "Training technicians on OEM equipment is the part most refurbishers skip.",
    SENTENCES,
  );
  assert.equal(normalized.ok, true, "whitespace differences must still verify");

  // A plausible-sounding invention is REJECTED. This is the whole product.
  const fabricated = verifyQuote(
    "We are the largest centrifuge refurbisher in Europe and doubled revenue last year.",
    "Doubling revenue while refurbishing hardware is rare.",
    SENTENCES,
  );
  assert.equal(fabricated.ok, false, "invented quote must be rejected");
  assert.ok(!fabricated.ok && fabricated.reason === "fabricated");

  // Paraphrase is rejected too — it is how hallucination sneaks in.
  const paraphrase = verifyQuote(
    "We ship centrifuges to over 40 countries.",
    "Forty countries is a lot of customs paperwork.",
    SENTENCES,
  );
  assert.equal(paraphrase.ok, false, "paraphrase must be rejected");

  // A trivially short "quote" matches too much to be evidence.
  assert.equal(verifyQuote("We ship", "Hi.", SENTENCES).ok, false, "too-short quote must be rejected");

  // Missing pieces.
  assert.equal(verifyQuote(SENTENCES[0].text, "", SENTENCES).ok, false, "empty line must be rejected");
  assert.equal(verifyQuote("", "A line.", SENTENCES).ok, false, "missing quote must be rejected");

  assert.equal(normalizeForCompare("  A “quoted”  word—here "), 'a "quoted" word-here');
}

// --- Tone: enforced mechanically, not merely asked for ------------------
{
  const good = "Refurbishing centrifuges for forty countries makes calibration a logistics problem.";
  assert.equal(isFiller(good), false, "a real observation must survive");

  // Openings that say nothing.
  assert.equal(isFiller("I came across your website and wanted to connect"), true);
  assert.equal(isFiller("Hey there, quick question about your lab"), true);
  assert.equal(isFiller("I noticed you ship to forty countries"), true);
  assert.equal(isFiller("Just reaching out about calibration"), true);

  // Compliments and hype.
  assert.equal(isFiller("Love what you're doing with lab equipment"), true);
  assert.equal(isFiller("Your site looks great and the work is impressive"), true);
  assert.equal(isFiller("You are a leading provider of centrifuges"), true);
  assert.equal(isFiller("Excited about your game-changing approach"), true);

  // Pitch and CTA have no place in a first line.
  assert.equal(isFiller("Would you be open to a quick call this week"), true);
  assert.equal(isFiller("Happy to book a demo whenever suits"), true);

  // Mechanical style rules.
  assert.equal(isFiller("Shipping to forty countries is a real feat!"), true, "no exclamation marks");
  assert.equal(isFiller("word ".repeat(45)), true, "a paragraph is not a first line");
  assert.equal(isFiller(""), true);

  // Handing their own tagline back is not an observation.
  const tagline = "We ship refurbished laboratory centrifuges to research teams in over forty countries each year.";
  assert.equal(
    isFiller("You ship refurbished laboratory centrifuges to research teams in forty countries.", tagline),
    true,
    "echoing the source sentence must be rejected",
  );
  assert.equal(isFiller(good, tagline), false, "a genuine inference from the same quote must survive");
}

// --- Extraction: boilerplate must not become a citation ---------------------
{
  const html = `<html><head><title>Acme Labs</title></head><body>
    <nav>Home About Contact</nav>
    <main>
      <p>We ship refurbished laboratory centrifuges to research teams in over forty countries each year.</p>
      <p>This site uses cookies to improve your experience and analyse traffic across our pages.</p>
      <p>Short bit.</p>
    </main>
    <footer>© 2026 Acme Labs. All rights reserved.</footer>
    <script>var x = "We ship nothing at all, this is script text that should never be quoted.";</script>
  </body></html>`;

  const out = extractSentences(html, "https://acme.test/");
  const texts = out.map((s) => s.text);
  assert.ok(texts.some((t) => t.includes("refurbished laboratory centrifuges")), "real prose must survive");
  assert.ok(!texts.some((t) => /cookies/i.test(t)), "cookie banner must be dropped");
  assert.ok(!texts.some((t) => /rights reserved/i.test(t)), "footer must be dropped");
  assert.ok(!texts.some((t) => /script text/i.test(t)), "script contents must never be quotable");
  assert.ok(!texts.some((t) => t === "Short bit."), "fragments must be dropped");
}

// --- Cost accounting: the other half of the promise -------------------------
{
  const free = getModel(DEFAULT_MODEL_ID)!;
  const cheap = getModel(CHEAPEST_MODEL_ID)!;

  // 1M in + 1M out priced exactly off the published rates.
  assert.equal(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, cheap), 0.375);

  // A realistic row: 3000 in, 120 out.
  const row = costUsd({ inputTokens: 3000, outputTokens: 120 }, cheap);
  assert.ok(Math.abs(row - 0.000261) < 1e-9, `expected ~$0.000261, got ${row}`);

  // THE HEADLINE. 10,000 rows must stay under $5 on the cheapest model.
  assert.ok(row * 10_000 < 5, "10k rows must cost under $5 on the cheapest model");

  // Gemini bills thinking tokens at the output rate, so a free-tier row costs
  // more than a Haiku row. Guard the claim rather than assume it.
  const geminiRow = costUsd({ inputTokens: 3000, outputTokens: 320 }, free);
  assert.ok(geminiRow > row, "Gemini row should cost more than the cheapest model");

  // Comparison uses the CHEAPEST competitor rate, never the most flattering.
  const cmp = comparisonFor(10_000, row * 10_000);
  assert.equal(cmp.competitor, "Smartwriter", "must compare against the cheapest published rate");
  assert.ok(cmp.multiple > 100, "multiple should be large but is derived, never hardcoded");

  assert.equal(costUsd({ inputTokens: 0, outputTokens: 0 }, cheap), 0);
}

// --- Tolerant JSON parsing --------------------------------------------------
{
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! Here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
  assert.equal(parseJsonLoose("not json at all"), null);
  assert.equal(parseJsonLoose(""), null);
  assert.equal(parseJsonLoose("[1,2,3]"), null, "a bare array is not a row object");
}

console.log("✓ grounding, extraction, cost accounting and parsing all hold");
