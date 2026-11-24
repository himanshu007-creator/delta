/**
 * The public page takes a domain straight from the URL and then FETCHES it.
 * That is an SSRF primitive, so this guard is the security boundary of the
 * whole free tier and it is tested like one.
 *
 *   npx tsx lib/public-dossier.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factLabel, isPublicFact, publicDomain, PUBLIC_KINDS } from "./public-dossier";
import { ADAPTERS } from "./sources/registry";

// --- must be REFUSED -------------------------------------------------------
{
  const blocked = [
    // Link-local cloud metadata. The reason this guard exists.
    "169.254.169.254", "http://169.254.169.254/latest/meta-data/",
    "metadata.google.internal", "metadata", "instance-data",
    // Our own services.
    "localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1", "0", "127.1",
    // Private ranges.
    "10.0.0.1", "192.168.1.1", "172.16.0.1",
    // Alternative IP notations that slip past naive hostname checks.
    "2130706433", "0x7f000001", "017700000001",
    // Reserved and internal-only suffixes.
    "foo.local", "db.internal", "box.lan", "site.test", "a.example", "x.invalid",
    "thing.onion", "1.2.3.4.in-addr.arpa", "app.localhost",
    // Malformed or hostile shapes.
    "", "   ", ".", "..", "-bad.com", "bad-.com", "no-tld", "a..b.com",
    "exam ple.com", "ex\nample.com", "a".repeat(260) + ".com",
    // Credential smuggling: the host after "@" is what a fetcher would use.
    "evil.com@169.254.169.254",
    // A scheme with no hostname left after stripping.
    "file:///etc/passwd",
  ];
  for (const b of blocked) {
    assert.equal(publicDomain(b), null, `MUST REFUSE: ${JSON.stringify(b)}`);
  }
}

// --- must be ACCEPTED, and normalised --------------------------------------
{
  const ok: [string, string][] = [
    ["example.com", "example.com"],
    ["EXAMPLE.COM", "example.com"],
    ["www.example.com", "example.com"],
    ["https://example.com", "example.com"],
    ["https://www.example.com/pricing?x=1", "example.com"],
    ["example.com:443", "example.com"],
    ["example.com.", "example.com"],
    ["  example.com  ", "example.com"],
    ["gpe.co.uk", "gpe.co.uk"],
    ["sub.domain.example.co.uk", "sub.domain.example.co.uk"],
    ["my-company.io", "my-company.io"],
    ["xn--80ak6aa92e.com", "xn--80ak6aa92e.com"],
    ["https%3A%2F%2Fexample.com", "example.com"],
    // Path traversal is not a threat here because the PATH IS DISCARDED — only
    // the hostname survives, and we build every URL ourselves from it.
    ["good.com/../../etc/passwd", "good.com"],
    ["example.com/pricing#frag", "example.com"],
    // The SCHEME is discarded too: we build `https://${domain}` ourselves, so a
    // hostile scheme cannot survive into a request.
    ["gopher://evil.com", "evil.com"],
  ];
  for (const [input, want] of ok) {
    assert.equal(publicDomain(input), want, `should accept ${JSON.stringify(input)}`);
  }
}

// --- idempotence: a normalised domain must survive a second pass -----------
{
  for (const d of ["example.com", "gpe.co.uk", "sub.a.example.com"]) {
    assert.equal(publicDomain(publicDomain(d)!), d, `${d} must be stable under re-normalisation`);
  }
}

// --- the curated fast set must actually exist -----------------------------
{
  const kinds = new Set(ADAPTERS.map((a) => a.kind));
  for (const k of PUBLIC_KINDS) {
    assert.ok(kinds.has(k), `PUBLIC_KINDS names "${k}" but no such adapter exists`);
  }
  // Public page budget: a stranger will not wait for 30 adapters.
  assert.ok(PUBLIC_KINDS.length <= 12, `the public set must stay small, got ${PUBLIC_KINDS.length}`);
  // The free tier gives away the PRESENT, so nothing history-shaped belongs
  // here beyond domain age — history is the paid product.
  assert.ok(
    !PUBLIC_KINDS.some((k) => /price_history|changes_feed|media_perception/.test(k)),
    "history must not leak into the free public set",
  );
}

// --- presentation ----------------------------------------------------------
{
  assert.equal(factLabel("corporate.company_number"), "Company number");
  assert.equal(factLabel("stack.vendor.anthropic"), "Uses anthropic");
  // An unmapped path must still render as something a human can read.
  assert.match(factLabel("some.new.unmapped_path"), /^New unmapped path$|^Unmapped path$/);

  // Internal machinery stays off a public page.
  assert.equal(isPublicFact({ path: "pricing.fingerprint", value: "x" }), false);
  assert.equal(isPublicFact({ path: "product.llmstxt.outline", value: "x" }), false);
  assert.equal(isPublicFact({ path: "pricing.tier.default.pro.monthly_minor", value: 1 }), false);
  // But the two lists that are genuinely the point stay visible.
  assert.equal(isPublicFact({ path: "stack.vendors.list", value: "a,b" }), true);
  assert.equal(isPublicFact({ path: "corporate.company_number", value: "596137" }), true);
}


// --- The API must use the SAME guard, not its own ------------------------
// lib/queries.ts had a local `needDomain` that accepted anything containing a
// dot, so `169.254.169.254` passed and the REST API and MCP server would
// crawl the cloud metadata endpoint on request. The page was never vulnerable
// because it calls publicDomain(); the API reimplemented the check, which is
// exactly how a guard gets bypassed.
{
  const queries = readFileSync(new URL("./queries.ts", import.meta.url), "utf8");
  assert.ok(
    /import \{ publicDomain \} from "\.\/domain"/.test(queries),
    "lib/queries.ts must import the shared SSRF guard",
  );
  assert.ok(
    /const needDomain[\s\S]{0,200}publicDomain\(p\.domain\)/.test(queries),
    "needDomain must delegate to publicDomain — never reimplement the check",
  );
  assert.ok(
    !/d\.includes\("\."\)/.test(queries),
    "the old dot-only check must be gone, not merely unused",
  );
}

console.log("✓ public-dossier: SSRF guard refuses metadata/private/IP-literal hosts, fast set verified");