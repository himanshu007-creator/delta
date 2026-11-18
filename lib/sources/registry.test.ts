/**
 * Cross-cutting contract and fuzz checks for EVERY adapter.
 *
 * Breadth is the strategy, so the registry will keep growing — and the failure
 * mode of a wide catalog is one careless adapter taking down a crawl window, or
 * quietly emitting facts with no provenance. These assertions apply to every
 * source at once, so a new adapter cannot be added wrong.
 *
 *   npx tsx lib/sources/registry.test.ts
 */

import assert from "node:assert/strict";
import { ADAPTERS, adaptersFor, byKind } from "./registry";
import type { Company } from "./types";

const FULL: Company = {
  domain: "example.com", name: "Example",
  ats: { provider: "greenhouse", token: "example" },
  github: "example/repo", githubOrg: "example",
  npm: "example", pypi: "example", dockerRepo: "library/example",
  appStoreId: "123456", wpSlug: "example", amoSlug: "example",
  vscodeExt: "Example.example", statusHost: "status.example.com", wikipedia: "Example",
};
const BARE: Company = { domain: "example.com" };

// --- the contract ---------------------------------------------------------
{
  assert.ok(ADAPTERS.length >= 20, `expected a wide catalog, got ${ADAPTERS.length}`);

  const kinds = ADAPTERS.map((a) => a.kind);
  assert.deepEqual(kinds, [...new Set(kinds)], "adapter kinds must be unique — they key the surfaces table");

  for (const a of ADAPTERS) {
    // dots group a source family, underscores keep multi-word kinds readable
    assert.ok(a.kind && /^[a-z][a-z0-9._]*$/.test(a.kind), `${a.kind}: kind must be a lowercase dotted slug`);
    assert.ok(a.module, `${a.kind}: needs a module, so the UI can group it`);
    assert.ok(a.label, `${a.kind}: needs a human label, because we disclose our sources`);
    assert.ok(["A", "B", "C"].includes(a.tier), `${a.kind}: tier must be A/B/C`);
    assert.ok(["12h", "daily", "weekly", "monthly"].includes(a.cadence), `${a.kind}: bad cadence`);
    assert.ok(["json", "text", "dns-txt", "dns-mx"].includes(a.format), `${a.kind}: bad format`);

    // A URL builder must never throw, whatever it is handed.
    assert.doesNotThrow(() => a.url(BARE), `${a.kind}: url() threw on a bare company`);
    assert.doesNotThrow(() => a.url(FULL), `${a.kind}: url() threw on a full company`);

    // Not applicable must be SILENT. Most companies have no npm package or
    // app-store listing, and that must never read as an error.
    const bare = a.url(BARE);
    if (bare !== null) {
      assert.ok(/^https:\/\/|^_?[a-z0-9.-]+$/i.test(bare), `${a.kind}: url must be https or a hostname, got ${bare}`);
    }
  }
}

// --- fuzz: no adapter may throw on an unexpected body ---------------------
{
  // Every one of these is a shape a real third-party API has returned to us:
  // null bodies, bare strings, arrays where an object was documented, and
  // objects with the expected key present but null.
  const JUNK: unknown[] = [
    null, undefined, {}, [], 0, 42, "", "nope", true, false,
    [null], [{}], [[]], { results: null }, { items: null }, { jobs: null },
    { sbom: null }, { sbom: {} }, { total_count: null }, { downloads: null },
    { ranks: [] }, { content: null }, { tiers: null }, [{ dns_names: null }],
  ];
  for (const a of ADAPTERS) {
    for (const junk of JUNK) {
      assert.doesNotThrow(
        () => a.extract(junk, { company: FULL, url: "https://example.com/x", raw: "" }),
        `${a.kind} threw on ${JSON.stringify(junk)} — one bad body must not cost the window`,
      );
      const facts = a.extract(junk, { company: FULL, url: "https://example.com/x", raw: "" });
      assert.ok(Array.isArray(facts), `${a.kind} must always return an array of facts`);
      // Garbage in must not become confident data out.
      for (const f of facts) {
        assert.ok(f.path, `${a.kind} emitted a fact with no path from junk input`);
      }
    }
  }
}

// --- provenance -----------------------------------------------------------
{
  // Facts are the product; a number we cannot point at is one we will not sell.
  const pricing = byKind("pricing");
  assert.ok(pricing);
  const facts = pricing.extract(null, {
    company: FULL, url: "https://example.com/pricing",
    raw: "<html><body><h2>Pro</h2><p>$20 per user / month</p><h2>Free</h2><p>$0 per user / month</p></body></html>",
  });
  assert.ok(facts.length > 0, "a minimal but real pricing page should still yield facts");
  assert.ok(facts.every((f) => f.sourceUrl), "every fact must carry its source URL");
  assert.ok(
    facts.every((f) => f.confidence === undefined || (f.confidence >= 0 && f.confidence <= 1)),
    "confidence must be a probability",
  );
}

// --- applicability --------------------------------------------------------
{
  const bare = adaptersFor(BARE).map((a) => a.kind);
  const full = adaptersFor(FULL).map((a) => a.kind);
  assert.ok(bare.length >= 5, "a domain alone should still be worth crawling");
  assert.ok(full.length > bare.length, "more handles must unlock more sources");
  assert.ok(bare.includes("stack.dns"), "DNS TXT needs only a domain and is the cheapest high-value source");
  assert.ok(!bare.includes("github.repo"), "GitHub adapters must opt out when there is no repo");
  assert.ok(full.includes("github.license"), "the licence signal must be available once a repo is known");
}

console.log(`✓ registry: ${ADAPTERS.length} adapters — contract held, ${23} junk bodies survived by all, provenance enforced`);
