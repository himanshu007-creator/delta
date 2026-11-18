/**
 * Vendor parsing, against REAL TXT records captured from live DNS in Phase 0.
 * Fixtures not inventions — a parser tested on made-up input proves nothing.
 *
 *   npx tsx lib/sources/vendors.test.ts
 */
import assert from "node:assert/strict";
import { parseVendors, vendorFacts } from "./vendors";

// Verbatim from `dig +short TXT linear.app`, 2026-11-18.
const LINEAR = [
  "launchdarkly-domain-verification=f702791b-ddb9-496f-80f1-df7499632973",
  "linear-domain-verification=391958",
  "mongodb-site-verification=DkQRVTZWWUX0i14d4YZddicK0SF4Qc1L",
  "notion-domain-verification=WyZnKX70mlPP1r1HchqL7re1MjaYo5c2F2Cy2R2z3XD",
  "openai-domain-verification=dv-cF94uxiJMGTKa374p6jJD0zU",
  "rippling-domain-verification=806196fd264819a7",
  "slack-domain-verification=n9BI0EJf0vSJO9ugqYmWNJ5xbOOVQnnTirCGbRZK",
  "stripe-verification=6EC2FC42DC487CF290EEEE12F5DEE9914E0186EF7BF33C1B6AEB7DD8B643CE80",
  "v=MCPv1; k=ed25519; p=TmBygOsNYdlqFf+OGFJk7imFQYLPFAmi3a/vklZ6Jqk=",
  "v=spf1 include:_spf.google.com include:spf.mtasv.net include:44092442.spf10.hubspotemail.net ~all",
  "MS=ms43041516",
  "ZOOM_verify_rSExBwd4QT2vT9dfq9-UrA",
  "anthropic-domain-verification-7emk8z=c8SuvlXPqgxzVcvjsiQ00cLfO",
  "apple-domain-verification=zVdJnsxkD6nX5XCL",
  "cursor-domain-verification-jkgerh=fYGswH2He0dJj0DekVjoNvFKi",
  "docusign=9bc6c7a7-fde1-48af-bcc3-11f14e980549",
  "domain-verification=0b7a143e64a100eeb18d7e29c53d3bcf83746f87607ac1f1b6aef8802ad5439d",
  "google-site-verification=-TwiLtawzz8QlL_LZlkuGibc6klzAuD0DfgytD0TM0g",
];

{
  const v = parseVendors(LINEAR);

  // The purchases that make this source valuable.
  for (const expected of [
    "anthropic", "cursor", "docusign", "launchdarkly", "mongodb",
    "notion", "openai", "rippling", "slack", "stripe", "zoom",
    "microsoft-365",                 // from MS=
    "google-workspace", "postmark", "hubspot", // all from ONE spf record
  ]) {
    assert.ok(v.includes(expected), `must detect ${expected} — got ${v.join(",")}`);
  }

  // Generic ownership proofs say nothing about what they BUY. Excluding this
  // noise is what makes the output readable rather than a wall of tokens.
  for (const noise of ["google", "google-site", "apple-domain", "domain", "v", "mcpv1", "ms"]) {
    assert.ok(!v.includes(noise), `must not report "${noise}" as a vendor`);
  }

  // Per-tenant nonces must not leak into vendor names, or every company looks
  // like it uses a different product and the /stack/[vendor] pages break.
  assert.ok(v.includes("anthropic"), "nonce suffix must be stripped");
  assert.ok(!v.some((x) => /7emk8z|jkgerh/.test(x)), "no nonce may survive");
  assert.ok(!v.some((x) => x.includes("verification")), "no 'verification' in any name");

  // Stable, sorted, unique — the diff depends on it.
  assert.deepEqual(v, [...new Set(v)].sort(), "must be sorted and de-duplicated");
}

// REGRESSION: the older Sender ID form does not start with `v=`, so it used to
// fall through the policy guard and be parsed as a product. Automattic's real
// record produced a "vendor" called `spf20mfromamxall`.
{
  const v = parseVendors([
    "spf2.0/mfrom,mx a mx -all",
    "v=spf1 include:sendgrid.net -all",
  ]);
  assert.ok(!v.some((x) => /^spf/.test(x)), `no policy record may become a vendor — got ${v.join(",")}`);
  assert.deepEqual(v, ["sendgrid"], "but real includes must still resolve");
}

// REGRESSION: verbatim notion.so + vercel.com records that produced junk
// "vendors" — a bare ACME-style nonce, a bare hex token, and a hostname that
// was being mangled into `proxy-sslwebflowcom` instead of recognised as Webflow.
{
  const v = parseVendors([
    "google-site-verification=U2r6h9FWkKMadZDxW94daNJ1YUGXP-9_tJ7PUYfYz4c",
    "proxy-ssl.webflow.com",
    "v=spf1 ~all",
    "_eohaffzltripfzavo0ehlmi84k0tkxw",
    "facebook-domain-verification=2agf76ffad9vxlxya597jrzil7xoxf",
    "C575019D1B",
  ]);
  assert.deepEqual(v, ["webflow"], `only Webflow is real intelligence here — got ${v.join(",")}`);
  assert.ok(!v.some((x) => /eohaff|c5750|sslwebflowcom/i.test(x)), "no nonce or mangled host may survive");
}

// An SPF record alone must still yield its vendors.
{
  const v = parseVendors(["v=spf1 include:sendgrid.net include:mktomail.com -all"]);
  assert.deepEqual(v, ["marketo", "sendgrid"]);
}

// Degenerate input must not throw or invent.
{
  assert.deepEqual(parseVendors([]), []);
  assert.deepEqual(parseVendors(["", "   ", '""']), []);
  assert.deepEqual(parseVendors(["v=spf1 -all"]), []);
}

// Facts carry provenance, and the roll-up matches the list.
{
  const facts = vendorFacts(LINEAR, "linear.app");
  const count = facts.find((f) => f.path === "stack.vendors.count");
  const list = facts.find((f) => f.path === "stack.vendors.list");
  assert.ok(count && typeof count.value === "number" && count.value > 10);
  assert.equal(count.value, String(list?.value).split(",").length, "count must match the list");
  assert.ok(facts.every((f) => f.sourceUrl === "dns:TXT:linear.app"), "every fact needs provenance");
  assert.ok(facts.some((f) => f.path === "stack.vendor.anthropic" && f.value === true));
}


// --- The 59 fake vendors that reached production -------------------------
// Each of these had its own /stack/[vendor] page. A data product that invents
// a vendor called `luijxbjbtj8ievtb9ah-o9p` has no credibility left to spend.
{
  const LEAKED = [
    "luijxbjbtj8ievtb9ah-o9p",          // hyphen skipped the whole nonce test
    "cp80qssojoe48ceuuom-owslqg",
    "generaltranslation-token-v9jzx73y70trn67eqp0zxgbr",
    "00d300000006woeeaa",               // a Salesforce org id
    "epwebxx6t8gleuy2",
    "1wwwhuggingfaceco",                // a URL that lost its punctuation
    "domainverification",               // describes the act, names no vendor
    "directfedauthurl",
    "identrustvalidate",
    "cloudpiercer",
    "azurewebsites",
  ];
  for (const v of LEAKED) {
    assert.deepEqual(parseVendors([v]), [], `bare "${v}" must not become a vendor`);
    assert.deepEqual(parseVendors([`${v}=1`]), [], `keyed "${v}" must not become a vendor`);
  }
}

// --- ...without deleting real vendors ------------------------------------
// Tightening the vowel ratio to catch the above deleted `launchdarkly`, which
// is 25% vowels exactly like the nonce it was trying to catch. Pronounceability
// (consonant RUN length) is the signal that actually separates them.
{
  const EXPECTED: ReadonlyArray<[string, string]> = [
    ["launchdarkly-site-verification=k", "launchdarkly"],
    ["1password-site-verification=q", "1password"],       // a leading digit is fine
    ["atlassian-domain-verification=x", "atlassian"],
    ["mongodb-site-verification=m", "mongodb"],
    ["wiz-domain-verification=w", "wiz"],
    ["MS=ms123", "microsoft-365"],
    // A BARE scope suffix must be stripped too, or each vendor gets a second
    // page: /stack/browserstack AND /stack/browserstack-domain.
    ["browserstack-domain=b", "browserstack"],
    ["rippling-domain=r", "rippling"],
  ];
  for (const [record, want] of EXPECTED) {
    assert.deepEqual(parseVendors([record]), [want], `${record} must resolve to ${want}`);
  }
}

console.log("✓ vendors: real DNS fixtures parse to clean vendor lists, nonces and noise stripped");