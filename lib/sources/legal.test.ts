/**
 * Legal intelligence, and the misattribution it must refuse.
 *
 * An insolvency notice bound to the wrong company is a defamatory statement
 * about a solvent business. Every case below is from a live query, including
 * the one that returns 139 unrelated notices.
 *
 *   npx tsx lib/sources/legal.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGAL_ADAPTERS, insolvencyFacts, ukLegalName } from "./legal";
import { handlesFrom, PHASE2_KINDS } from "../public-dossier";
import type { Fact } from "./types";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const val = (f: Fact[], p: string) => f.find((x) => x.path === p)?.value;
const adapter = LEGAL_ADAPTERS[0];
const URL_ = "https://www.thegazette.co.uk/all-notices/notice/data.feed";

// --- a true positive, confirmed by the notice's own title ----------------
{
  const facts = insolvencyFacts(fx("gazette-carillion.xml"), "Carillion plc", URL_);
  assert.equal(val(facts, "legal.insolvency.notices"), 1);
  assert.match(String(val(facts, "legal.insolvency.latest_notice")), /thegazette\.co\.uk/);
  assert.match(String(facts[0].quote), /Carillion plc/);
}

// --- THE REGRESSION: 139 notices that name other companies --------------
{
  /*
   * A live query of the insolvency category for "Linear" returns 139 notices
   * titled "Appointment of Liquidators", "Final Meetings" and similar. The
   * word appears somewhere in each; none concerns Linear. Reporting the search
   * count would have published 139 insolvency notices against a solvent
   * company.
   */
  const raw = fx("gazette-linear.xml");
  assert.ok(raw.length > 15_000, "the fixture must be the large noisy response");

  const facts = insolvencyFacts(raw, "Linear Limited", URL_);
  assert.equal(
    val(facts, "legal.insolvency.notices"),
    0,
    "a notice that does not NAME the company must never be counted against it",
  );
  assert.match(String(facts[0].quote), /No insolvency notice/);
}

// --- zero is a finding, not an absence ----------------------------------
{
  const facts = insolvencyFacts(fx("gazette-gymshark.xml"), "Gymshark Limited", URL_);
  assert.equal(val(facts, "legal.insolvency.notices"), 0);
  assert.equal(facts.length, 1, "exactly one fact: we looked, and the register holds nothing");
  assert.equal(facts[0].confidence, 1, "a completed search is certain about its own result");
}

// --- PRIVACY: the practitioner is never read ----------------------------
{
  /*
   * Every notice carries the insolvency practitioner's given and family name.
   * The unit of this product is the company. Compiling named individuals
   * across public records is the line this product does not cross, so those
   * fields are not parsed at all.
   */
  const raw = fx("gazette-carillion.xml");
  assert.match(raw, /<f:familyName>/, "the fixture must actually contain the personal fields");

  const facts = insolvencyFacts(raw, "Carillion plc", URL_);
  const text = JSON.stringify(facts);
  for (const field of ["familyName", "f:name"]) {
    assert.ok(!text.includes(field), `${field} must never reach a fact`);
  }

  const personal = /<f:familyName>([^<]+)</.exec(raw)?.[1];
  assert.ok(personal, "fixture sanity");
  assert.ok(
    !text.includes(personal!),
    "a named individual from a public record must never appear in our output",
  );

  const src = readFileSync(new URL("./legal.ts", import.meta.url), "utf8");
  assert.ok(
    !/familyName|f:name/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the extractor must not even reference the personal fields outside its comments",
  );
}

// --- only a registered name, with its suffix, is ever queried -----------
{
  assert.equal(ukLegalName({ domain: "a.com", legalName: "Monzo Bank Limited" }), "Monzo Bank Limited");
  assert.equal(ukLegalName({ domain: "a.com", legalName: "Carillion plc" }), "Carillion plc");
  assert.equal(ukLegalName({ domain: "a.com", legalName: "Gymshark Ltd." }), "Gymshark Ltd.");

  // A bare brand is a word search, which is what produced the 139 notices.
  assert.equal(ukLegalName({ domain: "a.com", legalName: "Linear" }), null);
  // A US corporation is out of jurisdiction for this register entirely.
  assert.equal(ukLegalName({ domain: "a.com", legalName: "NVIDIA CORP" }), null);
  assert.equal(ukLegalName({ domain: "a.com", legalName: "Cloudflare, Inc." }), null);
  assert.equal(ukLegalName({ domain: "a.com" }), null);

  // No registered name -> no request at all.
  assert.equal(adapter.url({ domain: "linear.app" }), null);
  assert.ok(adapter.url({ domain: "monzo.com", legalName: "Monzo Bank Limited" })?.includes("Monzo%20Bank%20Limited"));
}

// --- the handle is promoted only from a corroborated match --------------
{
  assert.equal(
    handlesFrom("monzo.com", [{ path: "corporate.legal_name", value: "Monzo Bank Limited", confidence: 1 }]).legalName,
    "Monzo Bank Limited",
  );

  /*
   * The GLEIF resolver writes `candidate_name` instead of `legal_name` when
   * the match was ambiguous — the Belgian company called "Stripe" is why. A
   * candidate must never reach a legal source.
   */
  assert.equal(
    handlesFrom("stripe.com", [{ path: "corporate.gleif.candidate_name", value: "STRIPE BVBA", confidence: 0.4 }]).legalName,
    undefined,
    "an ambiguous registry candidate must not be queried against the insolvency register",
  );
  assert.equal(
    handlesFrom("x.com", [{ path: "corporate.legal_name", value: "Guessy Limited", confidence: 0.5 }]).legalName,
    undefined,
    "a low-confidence legal name must not be queried either",
  );

  assert.ok((PHASE2_KINDS as readonly string[]).includes("legal.insolvency"));
}

console.log("✓ legal: a notice must name the company, 139 unrelated notices refused, practitioners never recorded");
