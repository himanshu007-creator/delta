/**
 * Security intelligence, and the attribution rule that bounds it.
 *
 * The central assertion in this file is a NEGATIVE one: that no adapter here
 * can attach a vulnerability to a company because a word matched. That is the
 * failure mode the module exists to prevent, and it is cheap to reintroduce
 * by adding one "convenient" keyword source later.
 *
 *   npx tsx lib/sources/security.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECURITY_ADAPTERS, npmPackage } from "./security";
import { handlesFrom, PHASE2_KINDS } from "../public-dossier";
import { byKind } from "./registry";
import type { Fact } from "./types";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const val = (f: Fact[], p: string) => f.find((x) => x.path === p)?.value;
const pkgAdapter = SECURITY_ADAPTERS.find((a) => a.kind === "security.advisories.package")!;
const repoAdapter = SECURITY_ADAPTERS.find((a) => a.kind === "security.advisories.repo")!;

// --- advisories against a package they publish ---------------------------
{
  const url = "https://api.github.com/advisories?affects=next";
  const facts = pkgAdapter.extract(fx("gh-advisories-next.json"), {
    company: { domain: "vercel.com", npm: "next" },
    url,
    raw: "",
  });

  assert.equal(val(facts, "security.advisories.count"), 84);
  assert.equal(val(facts, "security.advisories.critical"), 7);
  assert.equal(val(facts, "security.advisories.high"), 28);
  assert.equal(val(facts, "security.advisories.medium"), 40);
  assert.equal(val(facts, "security.advisories.low"), 9);

  // Worst severity, not merely "some exist".
  assert.equal(val(facts, "security.advisories.worst_severity"), "critical");

  /*
   * The SUBJECT is mandatory. "84 advisories" with nothing naming what they
   * concern is unreadable: a reader cannot tell whether it is the company's
   * flagship package or an abandoned utility.
   */
  assert.equal(val(facts, "security.advisories.subject"), "next");

  const latest = String(val(facts, "security.advisories.latest"));
  assert.match(latest, /^\d{4}-\d{2}-\d{2}$/, "a date, not a timestamp");

  // Every fact pointable-at, as everywhere else in this product.
  for (const f of facts) assert.ok(f.sourceUrl, `${f.path} needs a source`);

  // Bounded: one noisy package must not write an unbounded fact value.
  assert.ok(String(val(facts, "security.advisories.cves")).split(",").length <= 12);
}

// --- their own disclosures are a SEPARATE line ---------------------------
{
  const facts = repoAdapter.extract(fx("gh-repoadvisories-nextjs.json"), {
    company: { domain: "vercel.com", github: "vercel/next.js" },
    url: "https://api.github.com/repos/vercel/next.js/security-advisories",
    raw: "",
  });

  assert.equal(val(facts, "security.disclosures.count"), 79);
  assert.equal(val(facts, "security.disclosures.subject"), "vercel/next.js");

  /*
   * REGRESSION GUARD: these must not share paths with the package counts.
   * The same CVE appears in both feeds, so merging them would double-count
   * and report roughly twice the real number of advisories.
   */
  assert.ok(
    facts.every((f) => !f.path.startsWith("security.advisories.")),
    "self-published disclosures must never merge into the package advisory counts",
  );
}

// --- attribution: only artefacts we know are theirs ----------------------
{
  // No package and no repo -> no requests, no facts, no claims.
  for (const a of SECURITY_ADAPTERS) {
    assert.equal(a.url({ domain: "linear.app" }), null, `${a.kind} must not fire without an owned artefact`);
  }
  assert.ok(pkgAdapter.url({ domain: "vercel.com", npm: "next" })?.includes("affects=next"));
  assert.ok(repoAdapter.url({ domain: "vercel.com", github: "vercel/next.js" })?.includes("vercel/next.js"));

  /*
   * THE RULE, asserted against source text because it is a design constraint
   * rather than a behaviour.
   *
   * NVD returns 296 CVEs for the bare word "linear" — HDCP key exchange, an
   * IDAutomation barcode ActiveX control — none of which concern Linear the
   * issue tracker. A keyword adapter is the obvious next thing to add here and
   * it would publish fabricated findings assembled from true rows.
   */
  const src = readFileSync(new URL("./security.ts", import.meta.url), "utf8");
  assert.ok(
    !/keywordSearch|keyword_search/i.test(src),
    "no adapter in this module may query a vulnerability feed by keyword — see the linear.app case",
  );
  for (const a of SECURITY_ADAPTERS) {
    const u = a.url({ domain: "linear.app", name: "Linear" });
    assert.equal(u, null, "a company name must never on its own produce a vulnerability query");
  }
}

// --- the npm handle must be a package, not a scope -----------------------
{
  assert.equal(npmPackage({ domain: "a.com", npm: "next" }), "next");
  assert.equal(npmPackage({ domain: "a.com", npm: "@vercel/og" }), "@vercel/og");

  /*
   * REGRESSION: discovery scrapes npmjs.com/package/x and npmjs.com/org/x
   * with ONE pattern, so a bare scope arrives looking like a package name.
   * Querying `@vercel` returns nothing, forever and silently.
   */
  assert.equal(npmPackage({ domain: "a.com", npm: "@vercel" }), null, "a bare scope is not a package");
  assert.equal(npmPackage({ domain: "a.com", npm: "has space" }), null);
  assert.equal(npmPackage({ domain: "a.com" }), null);
}

// --- handle promotion only adopts unambiguous discoveries ----------------
{
  // Discovery marks a single candidate 0.9 and several 0.6. A guess must not
  // attach another project's vulnerabilities to this company.
  const sure = handlesFrom("vercel.com", [
    { path: "discovered.npm_org", value: "next", confidence: 0.9 },
    { path: "discovered.github_org", value: "vercel", confidence: 0.9 },
  ]);
  assert.equal(sure.npm, "next");
  assert.equal(sure.githubOrg, "vercel");

  const guessed = handlesFrom("vercel.com", [
    { path: "discovered.npm_org", value: "next,react,swr", confidence: 0.6 },
  ]);
  assert.equal(guessed.npm, undefined, "several candidates means discovery guessed — do not adopt it");

  for (const k of ["security.advisories.package", "security.advisories.repo"]) {
    assert.ok((PHASE2_KINDS as readonly string[]).includes(k), `${k} must run in phase two`);
    assert.ok(byKind(k), `${k} missing from the catalog`);
  }
}

console.log("✓ security: advisories only for artefacts they own, disclosures counted separately, no keyword attribution");
