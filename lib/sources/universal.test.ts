/**
 * Entity resolution must refuse to guess.
 *
 * A wrong legal identity is the most damaging kind of error this product can
 * make: it attributes one company's incorporation date, country and filings to
 * another. Worse, it looks authoritative — it comes from a registry.
 */

import assert from "node:assert/strict";
import { UNIVERSAL_ADAPTERS } from "./universal";

const gleif = UNIVERSAL_ADAPTERS.find((a) => a.kind === "corporate.gleif")!;
assert.ok(gleif, "the corporate.gleif adapter must exist");

const entity = (name: string, country = "BE", creationDate = "2025-10-03T00:00:00Z") => ({
  attributes: {
    lei: `LEI${name.replace(/\W/g, "").toUpperCase().slice(0, 17)}`,
    entity: {
      legalName: { name },
      status: "ACTIVE",
      legalAddress: { country },
      creationDate,
    },
  },
});

const run = (companyName: string, names: string[]) =>
  gleif.extract(
    { data: names.map((n) => entity(n)) },
    {
      company: { domain: "example.com", name: companyName },
      url: "https://api.gleif.org/probe",
      raw: "",
    },
  );

const pathsOf = (facts: ReturnType<typeof run>) => new Set(facts.map((f) => f.path));
const valueOf = (facts: ReturnType<typeof run>, path: string) =>
  facts.find((f) => f.path === path)?.value ?? null;

// --- THE regression: linear.app got "Linear Consulting" -------------------
// GLEIF's name filter is a CONTAINS search, so querying "Linear" returns ten
// unrelated entities. A prefix match used to score 0.75 and win.
{
  const facts = run("Linear", [
    "Linear Consulting",
    "LINEAR ENTERPRISES",
    "LINEAR S.R.L.",
    "THE LINEAR TRUST",
    "LINEAR PARTNERS LIMITED",
  ]);

  assert.equal(
    valueOf(facts, "corporate.gleif.matched"),
    false,
    "a shared first word is not identity: none of these is Linear, so nothing may be asserted",
  );
  assert.ok(
    !pathsOf(facts).has("corporate.legal_name"),
    "a near-miss must emit NO legal name — publishing another company's is worse than publishing nothing",
  );
  for (const leaked of ["corporate.incorporated_at", "geo.legal_country", "corporate.gleif.lei"]) {
    assert.ok(
      !pathsOf(facts).has(leaked),
      `${leaked} must not leak from an unmatched entity — it is another company's filing`,
    );
  }
  assert.equal(valueOf(facts, "corporate.gleif.candidates"), 5, "the near-miss count is the useful signal");
}

// --- An exact match, after normalising legal suffixes, still resolves ------
// This is the gpe.co.uk case: "Great Portland Estates" vs the registry's
// "GREAT PORTLAND ESTATES P L C". Tightening must not break it.
{
  const facts = run("Great Portland Estates", ["GREAT PORTLAND ESTATES P L C"]);
  assert.equal(
    valueOf(facts, "corporate.legal_name"),
    "GREAT PORTLAND ESTATES P L C",
    "suffix normalisation must still resolve a genuine exact match",
  );
  assert.equal(
    facts.find((f) => f.path === "corporate.legal_name")?.confidence,
    1,
    "an exact match is full confidence, not a guess",
  );
  assert.ok(pathsOf(facts).has("corporate.incorporated_at"), "a real match carries its filing data");
}

// --- A real match among decoys: asserted, but carrying its doubt ---------
{
  const facts = run("Linear", ["Linear Consulting", "LINEAR", "LINEAR S.R.L."]);
  assert.equal(valueOf(facts, "corporate.legal_name"), "LINEAR", "the exact match must win over the decoys");
  assert.equal(
    valueOf(facts, "corporate.gleif.ambiguous"),
    true,
    "an exact match among nine other same-word entities is still ambiguous, and must say so",
  );
  assert.equal(
    facts.find((f) => f.path === "corporate.legal_name")?.confidence,
    0.8,
    "an ambiguous match must not claim full confidence",
  );
}

// --- A single unambiguous candidate is full confidence -------------------
{
  const facts = run("Monzo", ["MONZO"]);
  assert.equal(valueOf(facts, "corporate.legal_name"), "MONZO", "one exact candidate, no ambiguity");
  assert.ok(!pathsOf(facts).has("corporate.gleif.ambiguous"), "one candidate is not ambiguous");
  assert.equal(facts.find((f) => f.path === "corporate.legal_name")?.confidence, 1);
}

// --- The deliberate under-resolution ------------------------------------
// "Oatly AB" is really Oatly, but `ab` is not in the suffix list, so this
// resolves to "not matched". That is the RIGHT trade and the list must stay
// conservative: stripping `as` would make Norwegian "COHERE AS" an exact match
// for Canadian Cohere, and stripping `stiftung` would make a German foundation
// an exact match for Cursor. Both are false identities, which are far worse
// than a gap. The normaliser also only strips SPACE-separated, unpunctuated
// suffixes, so "Elastic N.V." does not reduce either — same conservative bias.
// These resolve properly via a national registry, not via looser name matching.
{
  const facts = run("Oatly", ["Oatly AB"]);
  assert.equal(
    valueOf(facts, "corporate.gleif.matched"),
    false,
    "under-resolving is correct here — a wider suffix list would create false identities elsewhere",
  );
  assert.ok(!pathsOf(facts).has("corporate.legal_name"));
}

// --- The two false identities this must never produce again -------------
{
  // A German foundation is not the code-editor company.
  const cursor = run("Cursor", ["CURSOR Stiftung"]);
  assert.equal(valueOf(cursor, "corporate.gleif.matched"), false, "CURSOR Stiftung is not Cursor");
  assert.ok(!pathsOf(cursor).has("corporate.legal_name"));

  // A Norwegian AS is not the Canadian AI company.
  const cohere = run("Cohere", ["COHERE AS"]);
  assert.equal(valueOf(cohere, "corporate.gleif.matched"), false, "COHERE AS is not Cohere");
  assert.ok(!pathsOf(cohere).has("corporate.legal_name"));
}

// --- Junk must not resolve to anything ----------------------------------
for (const body of [{}, { data: null }, { data: [] }, { data: [null] }, { data: [{}] }]) {
  const facts = gleif.extract(body, {
    company: { domain: "example.com", name: "Linear" },
    url: "https://api.gleif.org/probe",
    raw: "",
  });
  assert.ok(Array.isArray(facts), `must return an array for ${JSON.stringify(body)}`);
  assert.ok(
    !facts.some((f) => f.path === "corporate.legal_name"),
    `must not invent a legal name from ${JSON.stringify(body)}`,
  );
}

console.log("✓ entity resolution refuses to guess: a shared word is not an identity");
