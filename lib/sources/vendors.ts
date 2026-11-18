/**
 * Vendor-stack extraction from public DNS TXT records.
 *
 * The highest-signal-per-request source in the whole catalog. When a company
 * buys a SaaS tool, that tool usually asks them to prove domain ownership by
 * publishing a TXT record — so the company's purchase list ends up in public
 * DNS, for free, in a form that diffs perfectly. A new record means they just
 * bought something.
 *
 * Verified live in Phase 0 (see PHASE0.md):
 *   figma.com   -> 1password, anthropic, atlassian, cursor, docusign, dropbox,
 *                  launchdarkly, mongodb, openai, postman, segment, stripe, wiz...
 *   vercel.com  -> carta, cursor, hackerone, loom, openai, planetscale, remote...
 *   linear.app  -> anthropic, cursor, launchdarkly, rippling, slack, stripe...
 *
 * Why this beats BuiltWith/Wappalyzer: those see only FRONTEND scripts. This
 * sees back-office purchases — HR, feature flags, security, cap table, AI
 * tooling — which is the part that actually reveals strategy.
 */

import { quote, type Fact } from "./types";

/**
 * SPF `include:` hosts map to the email/martech vendor that owns them. This is
 * the one place a lookup table genuinely beats a pattern, because the hostnames
 * look nothing like the product names.
 */
const SPF_VENDORS: ReadonlyArray<[RegExp, string]> = [
  [/spf\.mtasv\.net/i, "postmark"],
  [/hubspotemail\.net/i, "hubspot"],
  [/_spf\.google\.com|googlemail\.com/i, "google-workspace"],
  [/spf\.protection\.outlook\.com/i, "microsoft-365"],
  [/sendgrid\.net/i, "sendgrid"],
  [/amazonses\.com/i, "amazon-ses"],
  [/mailgun\.org/i, "mailgun"],
  [/mktomail\.com/i, "marketo"],
  [/pardot\.com/i, "pardot"],
  [/mcsv\.net|mailchimp/i, "mailchimp"],
  [/klaviyomail\.com/i, "klaviyo"],
  [/sparkpostmail\.com/i, "sparkpost"],
  [/createsend\.com|cmail\d/i, "campaign-monitor"],
  [/customeriomail\.com/i, "customer-io"],
  [/zendesk\.com/i, "zendesk"],
  [/salesforce\.com|exacttarget\.com/i, "salesforce"],
  [/intercom/i, "intercom"],
  [/braze\.com/i, "braze"],
  [/freshemail|freshdesk/i, "freshdesk"],
  [/mandrillapp\.com/i, "mandrill"],
  [/postmarkapp\.com/i, "postmark"],
  [/zoho/i, "zoho"],
];

/** Records that identify a vendor but do not follow the `<vendor>-…=` shape. */
const SPECIAL: ReadonlyArray<[RegExp, string]> = [
  [/^MS=/, "microsoft-365"],
  [/^ZOOM_verify/i, "zoom"],
  [/^adobe-idp-site-verification/i, "adobe"],
  [/^atlassian-domain-verification/i, "atlassian"],
  [/^cloudflare[-_]?dashboard[-_]?sso/i, "cloudflare-sso"],
  [/^globalsign-domain-verification|^_globalsign/i, "globalsign"],
  [/^onetrust-domain-verification/i, "onetrust"],
  [/^logmein-verification/i, "logmein"],
  [/^knowbe4-site-verification/i, "knowbe4"],
  [/^docker-verification/i, "docker"],
  [/^canva-site-verification/i, "canva"],
  [/^miro-domain-verification/i, "miro"],
  [/^jamf-domain-verification/i, "jamf"],
  [/^shopify-verification-code/i, "shopify"],
  [/^gradle-enterprise/i, "gradle"],
];

/**
 * Noise: generic ownership proofs and protocol records that say nothing about
 * what the company BUYS. Excluding these is what keeps the output readable.
 */
const IGNORE = new Set([
  "google-site", "google", "facebook-domain", "facebook", "apple-domain", "domain",
  "v", "spf", "dmarc", "dkim", "mcpv1", "ms", "_globalsign", "com", "net", "org",
  // Generic verification vocabulary. These describe the ACT of verifying, not
  // who is being verified, so they carry no vendor information at all — and
  // each one was generating its own /stack/ page.
  "domainverification", "directfedauthurl", "identrustvalidate", "globalsign",
  "verification", "verify", "validate", "site-verification", "domain-verification",
  "cloudpiercer", "azurewebsites", "appid", "asuid", "enterprise",
]);

/**
 * Verification nonces published as bare records, with no vendor name attached.
 *
 * Real examples that leaked through and became "vendors":
 *   notion.so  -> `_eohaffzltripfzavo0ehlmi84k0tkxw`
 *   vercel.com -> `C575019D1B`
 *
 * These would each have generated their own /stack/[vendor] page, which is how
 * a data product loses credibility. If it carries no information, drop it.
 */
function looksLikeNonce(v: string): boolean {
  if (/^[0-9a-f]{8,}$/i.test(v)) return true;          // pure hex blob
  if (/^[a-z0-9]{20,}$/i.test(v)) return true;         // very long unbroken run

  /*
   * Check each hyphen-separated SEGMENT, not just the whole string.
   *
   * The original test skipped anything containing a hyphen, which is how
   * `luijxbjbtj8ievtb9ah-o9p`, `cp80qssojoe48ceuuom-owslqg` and
   * `generaltranslation-token-v9jzx73y70trn67eqp0zxgbr` all became "vendors"
   * with their own public pages. A nonce does not stop being a nonce because
   * someone put a dash in it.
   */
  for (const seg of v.split("-")) {
    if (seg.length < 8) continue;

    // Digits mixed into letters mark an identifier, not a name. Four anywhere,
    // or three in a long segment — `epwebxx6t8gleuy2` carries exactly three.
    // The length guard protects real names with a numeric part, where the
    // number is its own short segment: microsoft-365, office-365, 1password.
    const digits = (seg.match(/\d/g) ?? []).length;
    if (digits >= 4 || (digits >= 3 && seg.length >= 12)) return true;

    /*
     * Five consecutive consonants. This is the signal that actually separates
     * a nonce from a brand, and the one a vowel ratio gets wrong.
     *
     * Real vendor names are pronounceable, so their consonant runs are short:
     * "launchdarkly" tops out at 4 (nchd), "browserstack" at 3. Random tokens
     * are not: "luijxbjbtj8ievtb9ah" contains "jxbjbtj", a run of 7. A vowel
     * RATIO cannot tell these apart — launchdarkly is 25% vowels and so is
     * that nonce — which is why tightening the ratio deleted a real vendor.
     */
    if (/[^aeiou\d]{5,}/.test(seg)) return true;

    // Only then the ratio, kept at the original threshold and length so it
    // stays a backstop rather than the primary test.
    const vowels = (seg.match(/[aeiou]/g) ?? []).length;
    if (seg.length >= 14 && vowels / seg.length < 0.25) return true;
  }

  // A mangled URL that lost its punctuation: `1wwwhuggingfaceco`.
  if (/^\d*www[a-z0-9]{6,}$/.test(v)) return true;

  return false;
}

/** Strip a verification suffix and any per-tenant nonce from a record key. */
function vendorFromKey(key: string): string | null {
  let v = key
    .replace(/[-_](domain|site|dns|txt)?[-_]?verification([-_][a-z0-9]{4,})?$/i, "")
    .replace(/[-_]verify.*$/i, "")
    // A BARE scope suffix, with no "verification" after it. `browserstack-domain`
    // and `rippling-domain` were minting a second /stack/ page per vendor.
    .replace(/[-_](domain|dns|txt|site|host|auth)$/i, "")
    .replace(/[-_]verification[-_][a-z0-9]+$/i, "")
    .replace(/[-_]code$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  // A trailing random tenant id, as in `anthropic-domain-verification-7emk8z`.
  v = v.replace(/-[a-z0-9]{5,8}$/i, (m) => (/[0-9]/.test(m) ? "" : m));
  if (!v || v.length < 3 || IGNORE.has(v)) return null;
  if (/^\d+$/.test(v)) return null;
  if (looksLikeNonce(v)) return null;
  return v;
}

/** Vendors referenced by an SPF record's include: directives. */
function vendorsFromSpf(record: string): string[] {
  if (!/^(v=spf1|spf2\.0)/i.test(record)) return [];
  return SPF_VENDORS.filter(([re]) => re.test(record)).map(([, name]) => name);
}

/**
 * The parser. Returns a sorted, de-duplicated vendor list.
 * Pure and synchronous so it is trivially testable against saved fixtures.
 */
export function parseVendors(txtRecords: readonly string[]): string[] {
  const out = new Set<string>();

  for (const raw of txtRecords) {
    const rec = raw.replace(/^"|"$/g, "").trim();
    if (!rec) continue;

    for (const v of vendorsFromSpf(rec)) out.add(v);

    // POLICY records are not purchases. `v=spf1`, DMARC/DKIM and the older
    // Sender ID form `spf2.0/mfrom,mx a -all` all fall here. Missing the spf2.0
    // case leaked a vendor literally named "spf20mfromamxall" into Automattic's
    // stack, which is exactly the kind of junk that destroys trust in the data.
    if (/^(v=|spf2\.0)/i.test(rec)) continue;

    const special = SPECIAL.find(([re]) => re.test(rec));
    if (special) { out.add(special[1]); continue; }

    // A bare HOSTNAME record names its vendor directly — notion.so publishes
    // `proxy-ssl.webflow.com`, which is real intelligence (they run Webflow).
    // Take the second-level label rather than mangling the dots away.
    if (!rec.includes("=") && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(rec) && rec.includes(".")) {
      const labels = rec.toLowerCase().split(".");
      const sld = labels[labels.length - 2];
      if (sld && sld.length >= 3 && !IGNORE.has(sld) && !looksLikeNonce(sld)) out.add(sld);
      continue;
    }

    const key = rec.split("=")[0]?.trim();
    if (!key) continue;
    const v = vendorFromKey(key);
    if (v) out.add(v);
  }

  return [...out].sort();
}

/** Turn a TXT record set into facts. One per vendor, plus the roll-up count. */
export function vendorFacts(txtRecords: readonly string[], domain: string): Fact[] {
  const vendors = parseVendors(txtRecords);
  const sourceUrl = `dns:TXT:${domain}`;
  return [
    { path: "stack.vendors.count", value: vendors.length, sourceUrl, confidence: 1 },
    { path: "stack.vendors.list", value: vendors.join(","), sourceUrl, confidence: 1 },
    ...vendors.map((v): Fact => ({
      path: `stack.vendor.${v}`,
      value: true,
      sourceUrl,
      confidence: 0.9, // a TXT record proves a relationship, not necessarily current paid use
      quote: quote(txtRecords.find((r) => r.toLowerCase().includes(v.split("-")[0])) ?? v, 80),
    })),
  ];
}
