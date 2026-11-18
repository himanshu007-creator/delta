/**
 * Company identity — who this actually IS, for any website.
 *
 * The gap this fills: gpe.co.uk produced 27 facts but no registered address, no
 * legal name beyond a registry guess, and no company type. Those are the first
 * things a Lookup buyer asks for, and most of them are published by the company
 * itself in places nobody reads.
 *
 * Verified before writing any of this:
 *   - `gymshark.com/.well-known/apple-app-site-association` returns
 *     `94R8K9KTH3.com.gymshark.store`. One fetch on ANY domain discovers their
 *     iOS app, which then unlocks App Store ratings, review text and version
 *     history — which is how a fashion retailer gets a reviews module without
 *     us knowing a thing about them in advance.
 *
 * PRIVACY GUARDRAIL, applied here specifically: an Impressum legally publishes
 * managing directors as the company's own filed data, so a COUNT and the
 * verbatim disclosure are recorded. No per-person facts are emitted, nothing is
 * cross-referenced against another source, and no people-search surface is
 * built. Aggregate to the company; never profile a person.
 */

import { collect, jsonLdBlocks, ldString, type LdNode } from "./jsonld";
import { asArr, asObj, decodeEntities, num, quote, type Adapter, type Fact } from "./types";

// ---------------------------------------------------------------------------
// schema.org Organization — and a free company-type classifier
// ---------------------------------------------------------------------------

/**
 * schema.org's own `@type` is a company classifier the site publishes for SEO.
 * It is how we decide which modules even matter: a ClothingStore needs catalog
 * and recall checks, a SoftwareApplication needs the GitHub bundle.
 */
const TYPE_CLASS: ReadonlyArray<[RegExp, string]> = [
  [/^(ClothingStore|ShoeStore|JewelryStore|DepartmentStore|OnlineStore|Store|GroceryStore|HomeGoodsStore|SportingGoodsStore)$/i, "retail"],
  [/^(SoftwareApplication|WebApplication|MobileApplication)$/i, "software"],
  [/^(RealEstateAgent|RealEstateListing)$/i, "property"],
  [/^(Restaurant|Hotel|LodgingBusiness|CafeOrCoffeeShop|BarOrPub)$/i, "hospitality"],
  [/^(FinancialService|BankOrCreditUnion|InsuranceAgency|AccountingService)$/i, "finance"],
  [/^(MedicalBusiness|Hospital|Pharmacy|Dentist|Physician)$/i, "healthcare"],
  [/^(NGO|Charity)$/i, "nonprofit"],
  [/^(EducationalOrganization|School|CollegeOrUniversity)$/i, "education"],
  [/^(Corporation)$/i, "enterprise"],
  [/^(LocalBusiness|ProfessionalService|HomeAndConstructionBusiness)$/i, "local-business"],
  [/^(Organization)$/i, "organisation"],
];

const ORG_TYPES = [
  "Organization", "Corporation", "LocalBusiness", "Store", "OnlineStore",
  "ClothingStore", "ShoeStore", "JewelryStore", "DepartmentStore", "GroceryStore",
  "HomeGoodsStore", "SportingGoodsStore", "RealEstateAgent", "Restaurant", "Hotel",
  "LodgingBusiness", "FinancialService", "BankOrCreditUnion", "InsuranceAgency",
  "MedicalBusiness", "Hospital", "NGO", "EducationalOrganization",
  "ProfessionalService", "HomeAndConstructionBusiness", "SoftwareApplication",
] as const;

function addressOf(node: LdNode): { full: string | null; city: string | null; country: string | null; postcode: string | null } {
  const a = asObj<LdNode>(collect(node.address, ["PostalAddress"])[0] ?? node.address);
  const street = ldString(a.streetAddress);
  const city = ldString(a.addressLocality);
  const region = ldString(a.addressRegion);
  const postcode = ldString(a.postalCode);
  const country = ldString(a.addressCountry);
  const parts = [street, city, region, postcode, country].filter(Boolean);
  return {
    full: parts.length ? parts.join(", ") : ldString(node.address),
    city, country, postcode,
  };
}

/**
 * Statutory website disclosure, extracted from any page's TEXT.
 *
 * The Companies Act 2006 requires a UK company to state its registered name,
 * company NUMBER, place of registration and registered office on its website —
 * and in practice that sits in the FOOTER of every page. So this runs against
 * the homepage we already fetch, costing no extra request, as well as /contact.
 * Verified: it pulled company number 596137 for gpe.co.uk.
 *
 * The company number is the valuable part: it is the key to Companies House,
 * and therefore to officers, charges, PSC and FILED ACCOUNTS — revenue and
 * profit for a private company.
 */
export function statutoryFacts(html: string, url: string): Fact[] {
  const text = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n"))
    .replace(/[ \t]+/g, " ");
  const f: Fact[] = [];
  const grab = (re: RegExp, g = 1): string | null => text.match(re)?.[g]?.replace(/\s+/g, " ").trim() || null;

  const coNo = grab(/(?:registered\s+(?:in\s+\w+(?:\s+and\s+\w+)?\s+)?(?:under\s+)?(?:company\s+)?(?:no|number)|company\s+(?:registration\s+)?(?:no|number))\.?:?\s*((?:[A-Z]{2})?\d{6,8})/i);
  if (coNo) {
    f.push({
      path: "corporate.company_number", value: coNo.toUpperCase(), sourceUrl: url, confidence: 0.9,
      quote: quote(grab(/([^\n]{0,80}(?:company\s+(?:no|number)|registered\s+(?:no|number))[^\n]{0,50})/i) ?? coNo, 160),
    });
  }
  const vat = grab(/\bVAT\s*(?:registration\s*)?(?:no|number|id)?\.?:?\s*((?:GB|[A-Z]{2})?\s?\d[\d\s]{6,12})/i);
  if (vat) f.push({ path: "corporate.vat_id", value: vat.replace(/\s+/g, "").toUpperCase(), sourceUrl: url, confidence: 0.85, quote: quote(vat, 60) });

  const office = grab(/registered\s+office(?:\s+(?:address|is|at))?\s*:?\s*([^\n]{12,200})/i);
  if (office) f.push({ path: "geo.registered_office", value: quote(office, 220), sourceUrl: url, confidence: 0.85, quote: quote(office, 220) });

  const place = grab(/registered\s+in\s+([A-Z][A-Za-z ]{3,40}?)(?:\s*[,.(]|\s+(?:no|number|under))/i);
  if (place) f.push({ path: "geo.place_of_registration", value: place, sourceUrl: url, confidence: 0.8 });

  const tel = grab(/(?:tel|phone|telephone|call us)\.?:?\s*(\+?[\d][\d\s().-]{7,20})/i);
  if (tel) f.push({ path: "contact.telephone", value: tel.replace(/\s+/g, " ").trim(), sourceUrl: url, confidence: 0.7 });

  const email = grab(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (email && !/example\.|sentry|wixpress|\.png|\.jpg/i.test(email)) {
    f.push({ path: "contact.email", value: email.toLowerCase(), sourceUrl: url, confidence: 0.7 });
  }
  return f;
}

export const IDENTITY_ADAPTERS: readonly Adapter[] = [
  {
    kind: "identity.schema",
    module: "14. Corporate",
    label: "Homepage identity (markup + statutory footer)",
    cadence: "weekly", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/`,
    rate: { minIntervalMs: 2000 },
    maxBytes: 6_000_000,
    extract: (_b, { raw, url }) => {
      // VERIFIED: gymshark, gpe and linear publish NO ld+json at all, so markup
      // cannot be the backbone of identity. The statutory FOOTER disclosure is
      // on this same page we already fetched, so read both.
      const statutory = statutoryFacts(raw, url);
      const nodes = jsonLdBlocks(raw).flatMap((b) => collect(b, ORG_TYPES));
      if (!nodes.length) return statutory;

      // Prefer the node that carries the most identity, not just the first.
      const score = (n: LdNode) =>
        ["legalName", "address", "telephone", "vatID", "taxID", "foundingDate", "numberOfEmployees"].filter((k) => n[k]).length;
      const best = nodes.slice().sort((a, b) => score(b) - score(a))[0];

      const rawType = (() => {
        const t = best["@type"];
        return typeof t === "string" ? t : Array.isArray(t) ? String(t[0] ?? "") : "";
      })();

      const f: Fact[] = [];
      const legal = ldString(best.legalName);
      const name = ldString(best.name);
      if (legal) f.push({ path: "corporate.legal_name", value: legal, sourceUrl: url, confidence: 0.95, quote: quote(legal, 120) });
      if (name && name !== legal) f.push({ path: "corporate.trading_name", value: name, sourceUrl: url, confidence: 0.9, quote: quote(name, 120) });

      // The classifier: it decides which other modules are worth running.
      const cls = TYPE_CLASS.find(([re]) => re.test(rawType));
      if (rawType) {
        f.push({ path: "identity.schema_type", value: rawType, sourceUrl: url, confidence: 1 });
        f.push({ path: "identity.company_type", value: cls ? cls[1] : "unknown", sourceUrl: url, confidence: cls ? 0.8 : 0.3 });
      }

      const addr = addressOf(best);
      if (addr.full) f.push({ path: "geo.address", value: quote(addr.full, 220), sourceUrl: url, confidence: 0.9, quote: quote(addr.full, 220) });
      if (addr.city) f.push({ path: "geo.city", value: addr.city, sourceUrl: url, confidence: 0.9 });
      if (addr.country) f.push({ path: "geo.country", value: addr.country, sourceUrl: url, confidence: 0.9 });
      if (addr.postcode) f.push({ path: "geo.postcode", value: addr.postcode, sourceUrl: url, confidence: 0.9 });

      const tel = ldString(best.telephone);
      if (tel) f.push({ path: "contact.telephone", value: tel, sourceUrl: url, confidence: 0.9 });
      const email = ldString(best.email);
      if (email) f.push({ path: "contact.email", value: email, sourceUrl: url, confidence: 0.9 });

      const vat = ldString(best.vatID) ?? ldString(best.taxID);
      if (vat) {
        // A VAT ID is the strongest bridge from a website to a legal entity:
        // it is verifiable against VIES, unlike a name.
        f.push({ path: "corporate.vat_id", value: vat.replace(/\s+/g, "").toUpperCase(), sourceUrl: url, confidence: 0.9, quote: quote(vat, 60) });
      }
      const founded = ldString(best.foundingDate);
      if (founded) f.push({ path: "corporate.founded", value: founded.slice(0, 10), sourceUrl: url, confidence: 0.85 });

      const emp = num(asObj<{ value?: unknown }>(best.numberOfEmployees).value ?? best.numberOfEmployees);
      if (emp !== null) f.push({ path: "org.employees_claimed", value: emp, sourceUrl: url, confidence: 0.7 });

      // `sameAs` is the company's own list of its profiles — a free, accurate
      // handle source that beats pattern-matching the page.
      const same = asArr<unknown>(best.sameAs).map((x) => ldString(x)).filter(Boolean) as string[];
      if (same.length) f.push({ path: "discovered.same_as", value: same.slice(0, 12).join(","), sourceUrl: url, confidence: 0.95 });

      // Markup wins on conflict (it is machine-authored), so statutory facts
      // only fill gaps rather than overwrite.
      const have = new Set(f.map((x) => x.path));
      return [...f, ...statutory.filter((x) => !have.has(x.path))];
    },
  },

  // ---- Impressum: a legally compelled company disclosure ----------------
  {
    /**
     * Germany, Austria and Switzerland REQUIRE a reachable imprint carrying the
     * legal name, address, commercial-register number, VAT ID and managing
     * directors. It is the single highest-density identity page on the web and
     * it is almost never used as intelligence.
     */
    kind: "identity.impressum",
    module: "14. Corporate",
    label: "Impressum / legal notice",
    cadence: "monthly", tier: "B", format: "text",
    // `/impressum` is correct for German SMEs. Multinationals bury it under a
    // locale path (siemens.com/impressum serves a 30KB SPA shell with none of
    // the statutory keywords), so the content guard below does the real work
    // and a 404 here is a normal outcome for a non-German company.
    url: (c) => `https://${c.domain}/impressum`,
    rate: { minIntervalMs: 2000 },
    maxBytes: 4_000_000,
    extract: (_b, { raw, url }) => {
      const text = decodeEntities(raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n"))
        .replace(/[ \t]+/g, " ");
      // A 200 is not proof: many sites serve their SPA shell for any path.
      if (!/\b(impressum|imprint|legal notice|angaben gem|offenlegung)\b/i.test(text)) return [];

      const f: Fact[] = [{ path: "identity.impressum_present", value: true, sourceUrl: url, confidence: 1 }];

      const grab = (re: RegExp): string | null => text.match(re)?.[1]?.replace(/\s+/g, " ").trim() || null;

      const vat = grab(/(?:USt[-\s]?IdNr\.?|Umsatzsteuer-Identifikationsnummer|VAT(?:\s+ID)?)[:\s.]*([A-Z]{2}\s?[0-9A-Z\s]{6,14})/i);
      if (vat) f.push({ path: "corporate.vat_id", value: vat.replace(/\s+/g, "").toUpperCase(), sourceUrl: url, confidence: 1, quote: quote(vat, 60) });

      const reg = grab(/\b(?:Handelsregister|Registernummer|Reg\.?-?Nr\.?)[:\s.]*((?:HRB|HRA|FN)\s?[0-9]{2,10}\s?[a-z]?)/i)
        ?? grab(/\b((?:HRB|HRA)\s?[0-9]{2,10})/i);
      if (reg) f.push({ path: "corporate.register_number", value: reg.toUpperCase(), sourceUrl: url, confidence: 0.95, quote: quote(reg, 60) });

      const court = grab(/(?:Registergericht|Amtsgericht)[:\s.]*([A-Za-zÄÖÜäöüß .-]{3,40})/i);
      if (court) f.push({ path: "corporate.register_court", value: court, sourceUrl: url, confidence: 0.9 });

      // GUARDRAIL: a count and the verbatim statutory disclosure. Deliberately
      // NOT per-person facts, and never cross-referenced anywhere else.
      const directors = text.match(/(?:Gesch[äa]ftsf[üu]hrer(?:in)?|Vertretungsberechtigt|Vertreten durch|Vorstand|Inhaber)[:\s.]*([^\n]{3,160})/i);
      if (directors) {
        const listed = directors[1].split(/,| und | & /).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 60);
        f.push({
          path: "corporate.officers_disclosed", value: listed.length, sourceUrl: url, confidence: 0.8,
          quote: quote(directors[0], 200),
        });
      }
      return f;
    },
  },

  // ---- contact / statutory footer disclosure ----------------------------
  {
    /**
     * The UK equivalent of an Impressum, and just as overlooked.
     *
     * The Companies Act 2006 requires a UK company to state its REGISTERED
     * NAME, company NUMBER, place of registration and registered office
     * address on its website. So the identity we want is legally compelled to
     * be there — and the company number is the key that unlocks Companies
     * House (officers, filed accounts, charges, PSC).
     *
     * This runs on /contact because schema.org coverage turned out to be thin:
     * gymshark, gpe and linear publish NO ld+json at all, so markup cannot be
     * the backbone of identity. Text on a contact page can.
     */
    kind: "identity.contact",
    module: "14. Corporate",
    label: "Contact / statutory disclosure",
    cadence: "monthly", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/contact`,
    rate: { minIntervalMs: 2000 },
    maxBytes: 4_000_000,
    extract: (_b, { raw, url }) => {
      const f = statutoryFacts(raw, url);
      return f.length ? [...f, { path: "identity.contact_page", value: true, sourceUrl: url, confidence: 1 }] : [];
    },
  },

  // ---- mobile apps: the handle that unlocks review modules --------------
  {
    /**
     * VERIFIED on gymshark.com: returns `94R8K9KTH3.com.gymshark.store`.
     * This is how a non-tech company gets an app-reviews module — we learn the
     * bundle ID from their own site rather than needing to be told.
     */
    kind: "identity.apps",
    module: "0. Discovery",
    label: "App association files",
    cadence: "monthly", tier: "A", format: "json",
    url: (c) => `https://${c.domain}/.well-known/apple-app-site-association`,
    rate: { minIntervalMs: 1500 },
    extract: (b, { url }) => {
      const root = asObj<Record<string, unknown>>(b);
      const ids = new Set<string>();
      for (const key of ["applinks", "appclips", "webcredentials", "activitycontinuation"]) {
        const section = asObj<{ details?: unknown; apps?: unknown }>(root[key]);
        for (const d of asArr<unknown>(section.details)) {
          const det = asObj<{ appID?: unknown; appIDs?: unknown }>(d);
          const one = ldString(det.appID);
          if (one) ids.add(one);
          for (const x of asArr<unknown>(det.appIDs)) { const s = ldString(x); if (s) ids.add(s); }
        }
        for (const x of asArr<unknown>(section.apps)) { const s = ldString(x); if (s) ids.add(s); }
      }
      if (!ids.size) return [];
      const list = [...ids];
      // Strip the Apple team prefix to leave the bundle id itself.
      const bundles = [...new Set(list.map((i) => i.split(".").slice(1).join(".")).filter(Boolean))];
      return [
        { path: "discovered.ios_bundle_ids", value: bundles.slice(0, 6).join(","), sourceUrl: url, confidence: 0.95, quote: quote(list[0], 80) },
        { path: "discovered.has_ios_app", value: true, sourceUrl: url, confidence: 1 },
      ];
    },
  },

  // ---- email + martech stack from DNS ------------------------------------
  {
    kind: "identity.mail",
    module: "7. Vendor & tech stack",
    label: "MX records (email provider)",
    cadence: "weekly", tier: "A", format: "dns-mx",
    url: (c) => c.domain,
    extract: (b, { url }) => {
      const hosts = asArr<unknown>(b).flatMap((r) => asArr<string>(r)).map((h) => String(h).toLowerCase());
      if (!hosts.length) return [];
      const PROVIDERS: ReadonlyArray<[RegExp, string]> = [
        [/google|googlemail/, "google-workspace"],
        [/protection\.outlook\.com|microsoft/, "microsoft-365"],
        [/zoho/, "zoho"],
        [/pphosted|proofpoint/, "proofpoint"],
        [/mimecast/, "mimecast"],
        [/messagelabs|symantec/, "symantec"],
        [/amazonaws|amazonses/, "amazon-ses"],
        [/mailgun/, "mailgun"],
        [/sendgrid/, "sendgrid"],
        [/fastmail|messagingengine/, "fastmail"],
        [/barracuda/, "barracuda"],
        [/mailcontrol|forcepoint/, "forcepoint"],
        [/trendmicro|hosted\.trendmicro/, "trend-micro"],
        [/secureserver|godaddy/, "godaddy"],
        [/yandex/, "yandex"],
      ];
      const hit = PROVIDERS.find(([re]) => hosts.some((h) => re.test(h)));
      return [
        { path: "stack.email_provider", value: hit ? hit[1] : "other", sourceUrl: url, confidence: hit ? 0.95 : 0.3, quote: quote(hosts[0], 80) },
        { path: "stack.mx_hosts", value: hosts.slice(0, 5).join(","), sourceUrl: url, confidence: 1 },
      ];
    },
  },

  // ---- DMARC: email security maturity -----------------------------------
  {
    kind: "identity.dmarc",
    module: "15. Reliability & security posture",
    label: "DMARC policy",
    cadence: "weekly", tier: "A", format: "dns-txt",
    url: (c) => `_dmarc.${c.domain}`,
    extract: (b, { url }) => {
      const rec = asArr<unknown>(b).map((r) => asArr<string>(r).join("")).find((s) => /^v=DMARC1/i.test(s));
      if (!rec) return [{ path: "security.dmarc_policy", value: "none-published", sourceUrl: url, confidence: 1 }];
      const policy = rec.match(/\bp\s*=\s*(none|quarantine|reject)\b/i)?.[1].toLowerCase() ?? "unknown";
      return [
        // "reject" means a mature, enforced email programme; "none" means it is
        // published but unenforced, which is the common half-finished state.
        { path: "security.dmarc_policy", value: policy, sourceUrl: url, confidence: 1, quote: quote(rec, 140) },
        { path: "security.dmarc_enforced", value: policy === "reject" || policy === "quarantine", sourceUrl: url, confidence: 1 },
      ];
    },
  },

  // ---- their stance on AI crawlers ---------------------------------------
  {
    kind: "identity.ai_stance",
    module: "1. Positioning",
    label: "robots.txt AI-crawler rules",
    cadence: "weekly", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/robots.txt`,
    rate: { minIntervalMs: 1500 },
    maxBytes: 1_000_000,
    extract: (_b, { raw, url }) => {
      if (!/user-agent/i.test(raw)) return [];
      const AI_BOTS = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "PerplexityBot", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot"];
      // Only count a bot as blocked if its own block actually disallows.
      const blocked = AI_BOTS.filter((bot) => {
        const m = raw.match(new RegExp(`user-agent:\\s*${bot}\\b([\\s\\S]*?)(?=\\nuser-agent:|$)`, "i"));
        return m ? /disallow:\s*\//i.test(m[1]) : false;
      });
      return [
        { path: "site.ai_crawlers_blocked", value: blocked.length, sourceUrl: url, confidence: 1 },
        {
          // A 2025-26 signal almost nobody tracks: whether a company is fencing
          // off its content from AI training, which says a lot about strategy.
          path: "site.ai_crawlers_blocked_list", value: blocked.sort().join(","), sourceUrl: url, confidence: 1,
          ...(blocked.length ? { quote: quote(`blocks ${blocked.join(", ")}`, 140) } : {}),
        },
      ];
    },
  },
] as const;
