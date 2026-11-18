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
  if (!v.includes("-") && v.length >= 14) {
    const vowels = (v.match(/[aeiou]/gi) ?? []).length;
    if (vowels / v.length < 0.25) return true;         // no word-like structure
  }
  return false;
}

/** Strip a verification suffix and any per-tenant nonce from a record key. */
function vendorFromKey(key: string): string | null {
  let v = key
    .replace(/[-_](domain|site|dns|txt)?[-_]?verification([-_][a-z0-9]{4,})?$/i, "")
    .replace(/[-_]verify.*$/i, "")
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
