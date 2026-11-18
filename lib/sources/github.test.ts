/**
 * The GitHub bundle, against saved snapshots of real API responses.
 *
 * Fixtures rather than live calls: the API is rate-limited (60/hr
 * unauthenticated) and its numbers move daily, so a live test would be both
 * flaky and a bad neighbour. Every expectation here is read off the frozen
 * response in ./fixtures.
 *
 *   npx tsx lib/sources/github.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GITHUB_ADAPTERS } from "./github";
import type { Company, Fact } from "./types";

const fx = (n: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

const CO: Company = { domain: "example.com", github: "hashicorp/terraform", githubOrg: "vercel" };
const adapter = (kind: string) => {
  const a = GITHUB_ADAPTERS.find((x) => x.kind === kind);
  assert.ok(a, `missing adapter: ${kind}`);
  return a;
};
const run = (kind: string, body: unknown, company = CO): Fact[] =>
  adapter(kind).extract(body, { company, url: `https://api.github.com/${kind}`, raw: "" });
const val = (fs: Fact[], path: string) => fs.find((f) => f.path === path)?.value;
const conf = (fs: Fact[], path: string) => fs.find((f) => f.path === path)?.confidence;

// --- the licence signal, which is the point of this bundle -----------------
{
  // VERIFIED: GitHub reports spdx="NOASSERTION", key="other", name="Other" for
  // every source-available licence. So github.repo must NOT claim to know.
  const repo = run("github.repo", fx("gh-repo-terraform.json"));
  assert.equal(val(repo, "product.github.license"), "NOASSERTION");
  assert.equal(val(repo, "product.github.license_unresolved"), true, "the ambiguity must be flagged, not guessed past");
  assert.ok(
    !repo.some((f) => f.path === "product.github.license_restrictive"),
    "github.repo cannot determine restrictiveness and must not pretend to — that belongs to github.license",
  );

  // Reading the LICENSE TEXT is what actually resolves it.
  const busl = run("github.license", fx("gh-license-terraform.json"));
  assert.equal(val(busl, "product.github.license_detected"), "BUSL-1.1", "Terraform relicensed to the Business Source License");
  assert.equal(val(busl, "product.github.license_restrictive"), true, "a relicence IS a business-model change");
  assert.equal(conf(busl, "product.github.license_detected"), 1, "licence text is unambiguous evidence");
  assert.ok(busl.find((f) => f.path === "product.github.license_detected")?.quote, "must quote the licence text it read");

  const mit = run("github.license", fx("gh-license-next.json"));
  assert.equal(val(mit, "product.github.license_detected"), "MIT");
  assert.equal(val(mit, "product.github.license_restrictive"), false, "MIT must never be flagged restrictive");
}

// --- repo core -------------------------------------------------------------
{
  const f = run("github.repo", fx("gh-repo-terraform.json"));
  for (const p of ["stars", "forks", "open_issues", "watchers", "size_kb", "pushed_at", "created_at"]) {
    assert.ok(val(f, `product.github.${p}`) !== undefined, `missing product.github.${p}`);
  }
  assert.equal(typeof val(f, "product.github.stars"), "number");
  assert.equal(val(f, "product.github.archived"), false, "archived=true means the product is dead; it must be reported");
  assert.ok(String(val(f, "product.github.topics")).includes("terraform"));
  assert.ok(f.every((x) => x.sourceUrl), "provenance on every fact");
}

// --- languages: a new language appearing is a story ------------------------
{
  const f = run("github.languages", fx("gh-languages-next.json"));
  const langs = String(val(f, "stack.languages"));
  assert.ok(langs.startsWith("JavaScript"), `expected JS first, got ${langs}`);
  assert.ok(langs.includes("Rust"), "Rust in a JS codebase is a rewrite signal and must survive");
  const pcts = f.filter((x) => /_pct$/.test(x.path)).map((x) => Number(x.value));
  assert.ok(pcts.length >= 3);
  assert.ok(pcts.every((n) => n >= 0 && n <= 100), "percentages must be percentages");
  assert.ok(Math.max(...pcts) > 30, "the dominant language should dominate");
}

// --- releases: asset downloads are REAL adoption, unlike stars -------------
{
  const f = run("github.releases", fx("gh-releases-cli.json"));
  assert.ok(String(val(f, "product.github.latest_tag")).startsWith("v"), "a version tag");
  assert.ok(Number(val(f, "product.github.release_downloads")) > 1000, "cli/cli assets have real download counts");
  assert.equal(val(f, "product.github.releases_tracked"), 10);
  const cadence = Number(val(f, "product.github.release_cadence_days"));
  assert.ok(cadence >= 0 && cadence < 400, `release cadence should be plausible, got ${cadence}`);
  assert.ok(val(f, "product.github.latest_release_at"), "a dated release");
}

// --- contributors: key-person risk ----------------------------------------
{
  const f = run("github.contributors", fx("gh-contributors-tf.json"));
  assert.ok(Number(val(f, "org.github.contributors")) > 10);
  assert.ok(val(f, "org.github.top_contributor"), "a named top contributor");
  const share = Number(val(f, "org.github.top_contributor_share_pct"));
  assert.ok(share > 0 && share <= 100, `share must be a percentage, got ${share}`);
}

// --- events: typed activity feed ------------------------------------------
{
  const body = fx("gh-events-vercel.json") as unknown[];
  const f = run("github.events", body);
  // Against the fixture's own length, not a magic number: GitHub returns "up
  // to" per_page, and the adapter correctly reports what it actually saw.
  assert.equal(val(f, "product.github.events_sampled"), body.length);
  const typed = f.filter((x) => x.path.startsWith("product.github.event."));
  assert.ok(typed.length >= 3, "several event types should be present");
  // "PushEvent" must be reported as "push", not "pushevent".
  assert.ok(typed.every((x) => !/event\.\w*event$/.test(x.path)), `the Event suffix must be stripped: ${typed.map((t) => t.path).join()}`);
  assert.ok(
    typed.reduce((a, b) => a + Number(b.value), 0) <= body.length,
    "typed counts cannot exceed the sample",
  );
}

// --- degenerate input must never throw ------------------------------------
{
  // GitHub's /stats/* endpoints answer 202 with an empty body while computing.
  // That is not a failure, and for very large repos it may never resolve.
  for (const empty of [[], {}, null, undefined]) {
    assert.deepEqual(run("github.activity", empty), [], `202-style body ${JSON.stringify(empty)} must yield no facts, not an error`);
  }
  // Nothing here may throw on a shape we did not expect.
  for (const a of GITHUB_ADAPTERS) {
    for (const junk of [null, undefined, {}, [], 42, "nope", { sbom: {} }, { total_count: null }]) {
      assert.doesNotThrow(() => a.extract(junk, { company: CO, url: "u", raw: "" }), `${a.kind} threw on ${JSON.stringify(junk)}`);
    }
  }
}

// --- the contract ---------------------------------------------------------
{
  for (const a of GITHUB_ADAPTERS) {
    assert.ok(a.kind.startsWith("github."), `${a.kind} should be namespaced`);
    assert.ok(a.module, `${a.kind} needs a module for the UI`);
    assert.ok(a.label, `${a.kind} needs a human label for source disclosure`);
    assert.ok(a.headers, `${a.kind} must send the GITHUB_TOKEN — unauth is 60/hr and 401s on some endpoints`);
    // Not applicable must be silent, not an error.
    assert.equal(a.url({ domain: "nogithub.com" }), null, `${a.kind} must opt out when a company has no repo`);
  }
  // The token is read per call, not frozen at import.
  const before = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token-123";
  assert.match(
    String(adapter("github.repo").headers!().authorization),
    /test-token-123/,
    "headers() must read the token at call time so a late-added credential is picked up",
  );
  if (before === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = before;
}

console.log("✓ github: licence relicensing detected from text, 10 adapters, every unexpected shape survives");
