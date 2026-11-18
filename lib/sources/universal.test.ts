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

const entity = (name: string, country = "XX", creationDate = "2025-10-03T00:00:00Z") => ({
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

/** `names` may be "NAME" or "NAME|CC" to set that entity's country. */
const run = (companyName: string, names: string[], domain = "example.com") =>
  gleif.extract(
    {
      data: names.map((n) => {
        const [nm, cc] = n.split("|");
        return entity(nm, cc ?? "XX");
      }),
    },
    {
      company: { domain, name: companyName },
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

// --- Corroboration: the three ways a match becomes sound -----------------
{
  // 1. Several exact matches, all in ONE country: a group sharing a registered
  //    name. GLEIF returns GYMSHARK LTD and GYMSHARK GROUP LIMITED, both GB.
  //    Refusing these threw away ~50 correct resolutions.
  const gym = run("Gymshark", ["GYMSHARK GROUP LIMITED|GB", "GYMSHARK LTD|GB"]);
  assert.equal(valueOf(gym, "corporate.legal_name"), "GYMSHARK LTD", "the shortest name is the parent, not a benefit vehicle");
  assert.equal(valueOf(gym, "corporate.gleif.basis"), "single-country-group");
  assert.equal(valueOf(gym, "geo.legal_country"), "GB");
  assert.equal(valueOf(gym, "corporate.related_entities"), 1);

  // 2. ccTLD corroboration: gpe.co.uk matching a GB entity agrees.
  const gpe = run("Great Portland Estates",
    ["GREAT PORTLAND ESTATES PLC LTIP EST|GG", "GREAT PORTLAND ESTATES P L C|GB"], "gpe.co.uk");
  assert.equal(valueOf(gpe, "corporate.legal_name"), "GREAT PORTLAND ESTATES P L C");
  assert.equal(valueOf(gpe, "corporate.gleif.basis"), "cctld-corroborated");

  // ...and the same match WITHOUT an agreeing ccTLD stays unverified.
  const gpeCom = run("Great Portland Estates",
    ["GREAT PORTLAND ESTATES PLC LTIP EST|GG", "GREAT PORTLAND ESTATES P L C|GB"], "gpe.com");
  assert.ok(!pathsOf(gpeCom).has("corporate.legal_name"), ".com offers no corroborating signal");

  // 3. A sole candidate needs no corroboration: nothing competes with it.
  const sole = run("Monzo", ["MONZO|GB"]);
  assert.equal(valueOf(sole, "corporate.gleif.basis"), "sole-candidate");
}

// --- An exact match among decoys resolves to NOTHING ---------------------
// stripe.com matched a Belgian company genuinely named "Stripe", incorporated
// 2007, and the page showed "Registered: Belgium · founded 2007" with a
// crosshair on a map. Both facts belonged to somebody else entirely.
{
  // The real Stripe case: one exact match, in Belgium, on a .com domain, with
  // nine other entities returned. The genuine Stripe, Inc. was not even on the
  // truncated page.
  const facts = run("Stripe",
    ["STRIPE|BE", "Stripe 158|IE", "Stripe 157|IE", "STRIPE 156|IE", "STRIPE 151|IE"], "stripe.com");
  assert.equal(valueOf(facts, "corporate.gleif.ambiguous"), true);
  for (const leaked of ["corporate.legal_name", "geo.legal_country", "corporate.incorporated_at", "corporate.status", "corporate.gleif.lei"]) {
    assert.ok(!pathsOf(facts).has(leaked), `${leaked} must not be attributed — it belongs to a Belgian company`);
  }
  // Kept as a checkable lead under its own path, never promoted.
  assert.equal(valueOf(facts, "corporate.gleif.candidate_name"), "STRIPE");
  assert.equal(valueOf(facts, "corporate.gleif.candidate_country"), "BE");
  assert.equal(
    facts.find((f) => f.path === "corporate.gleif.candidate_name")?.confidence,
    0.4,
    "a lead must be low confidence so nothing downstream treats it as identity",
  );
}

// --- A single unambiguous candidate is full confidence -------------------
{
  const facts = run("Monzo", ["MONZO"]);
  assert.equal(valueOf(facts, "corporate.legal_name"), "MONZO", "one exact candidate, no ambiguity");
  assert.ok(!pathsOf(facts).has("corporate.gleif.ambiguous"), "one candidate is not ambiguous");
  assert.equal(facts.find((f) => f.path === "corporate.legal_name")?.confidence, 1);
  assert.ok(pathsOf(facts).has("geo.legal_country"), "a sound resolution does carry its filing data");
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
