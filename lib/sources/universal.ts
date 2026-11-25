/**
 * Sources that work for ANY domain — the fix for a tech-shaped catalog.
 *
 * Running the registry against gpe.co.uk (a London office landlord, not a SaaS
 * company) exposed the real problem: only 8 of 27 adapters even APPLIED, and
 * half of those 404'd, for 13 facts against 43+ for a tech company. Most of the
 * catalog needs a GitHub repo, an llms.txt, an ATS board or a status page — and
 * most companies in the world have none of those.
 *
 * Everything here needs nothing but a domain:
 *
 *  - discover   reads the homepage and sitemap for HANDLES (github org, status
 *               host, ATS board, socials). This is the highest-leverage adapter
 *               in the whole registry: it is what turns "8 of 27 applicable"
 *               into the full catalog for companies that do have a footprint
 *               but whose handles we never knew.
 *  - sitemap    page count and section shape; new sections appear here first.
 *  - gleif      keyless legal-entity registry, worldwide. VERIFIED: resolved
 *               GREAT PORTLAND ESTATES P L C to LEI 213800JMEDD2Q4N1MC42.
 *  - wayback    domain age. VERIFIED: gpe.co.uk archived since 1999-10-07, a
 *               27-year-old domain, which is an incumbency signal a startup
 *               cannot fake.
 */

import { asArr, asObj, asObjArr, decodeEntities, num, quote, type Adapter, type Company, type Fact } from "./types";
import { competitorFacts } from "./competitors";
import { ecosystemFacts } from "./ecosystem";

// ---------------------------------------------------------------------------
// handle discovery
// ---------------------------------------------------------------------------

/**
 * Handles we can lift straight out of a homepage. Each unlocks adapters that
 * would otherwise sit inert because nobody told us the identifier.
 *
 * LinkedIn is captured as a FACT only — never fetched. Scraping it gets
 * customers' accounts banned, so the handle is recorded for a human and the
 * crawler never touches the site.
 */
const HANDLE_PATTERNS: ReadonlyArray<[string, RegExp, string]> = [
  ["github_org", /github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)(?:[/"'?#]|$)/gi, "unlocks the 10 GitHub adapters"],
  ["status_host", /\b((?:[a-z0-9-]+\.)?status(?:page)?\.[a-z0-9.-]+|[a-z0-9-]+\.statuspage\.io)\b/gi, "unlocks reliability + MTTR"],
  ["ats_greenhouse", /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/gi, "unlocks hiring + geography"],
  ["ats_lever", /jobs\.lever\.co\/([a-z0-9_-]+)/gi, "unlocks hiring + geography"],
  ["ats_ashby", /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/gi, "unlocks hiring + geography"],
  ["ats_workable", /([a-z0-9_-]+)\.workable\.com/gi, "unlocks hiring + geography"],
  ["ats_teamtailor", /([a-z0-9_-]+)\.teamtailor\.com/gi, "unlocks hiring + geography"],
  ["ats_bamboohr", /([a-z0-9_-]+)\.bamboohr\.com/gi, "unlocks hiring + geography"],
  ["youtube", /youtube\.com\/(@[A-Za-z0-9_.-]+|c\/[A-Za-z0-9_.-]+|channel\/[A-Za-z0-9_-]+)/gi, "unlocks video cadence"],
  ["npm_org", /npmjs\.com\/(?:package|org)\/([@a-z0-9_.\/-]+)/gi, "unlocks download curves"],
  ["docs_host", /\b((?:docs|developer|developers)\.[a-z0-9-]+\.[a-z.]{2,12})\b/gi, "unlocks API-surface diffing"],
  // Recorded, never fetched.
  ["linkedin", /linkedin\.com\/company\/([A-Za-z0-9_.-]+)/gi, "recorded for humans; we never crawl LinkedIn"],
];

/** Reject the obvious non-handles a homepage is full of. */
const JUNK_HANDLE = /^(about|home|index|login|signup|search|sponsors|topics|features|pricing|site|www|en|us|readme|license|security|orgs|users|new|explore|marketplace|collections|trending|apps|settings)$/i;

/**
 * ISO 639-1 language codes.
 *
 * Used to tell a locale path from a product path. Without it any two-letter
 * URL segment became a "market".
 */
const ISO_639_1 = new Set(
  ("aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
   "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu " +
   "hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb " +
   "lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om " +
   "or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw " +
   "ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu").split(" "),
);

/**
 * Country implied by a ccTLD, used to corroborate a registry match.
 *
 * A company on `.co.uk` whose exact-name registry entity is also GB is a sound
 * resolution; the same name match with no agreeing signal is not. This is the
 * cheapest corroborating evidence available — it costs no request.
 */
const CCTLD_COUNTRY: Record<string, string> = {
  uk: "GB", de: "DE", fr: "FR", nl: "NL", es: "ES", it: "IT", se: "SE", no: "NO",
  dk: "DK", fi: "FI", ie: "IE", ca: "CA", au: "AU", in: "IN", jp: "JP", sg: "SG",
  ch: "CH", at: "AT", be: "BE", pl: "PL", pt: "PT", br: "BR", mx: "MX", nz: "NZ",
  za: "ZA", il: "IL", cz: "CZ", ro: "RO", hu: "HU", gr: "GR", tr: "TR", kr: "KR",
};

const tldCountry = (domain: string): string | null => {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  return CCTLD_COUNTRY[tld] ?? null;
};

/**
 * Scan a page for the handles that unlock the rest of the catalog.
 *
 * Shared by the homepage and the careers page because they carry different
 * subsets: a homepage almost never links the job board, which is why ATS
 * tokens went undiscovered and the whole hiring module stayed silent for every
 * company whose careers page lives one click away.
 */
export function scanHandles(raw: string, url: string, domain: string): Fact[] {
  const f: Fact[] = [];
  const own = domain.replace(/^www\./, "");

  for (const [name, re, why] of HANDLE_PATTERNS) {
    const hits = new Set<string>();
    for (const m of raw.matchAll(re)) {
      const v = (m[1] ?? "").trim().replace(/\/$/, "");
      if (!v || v.length > 60 || JUNK_HANDLE.test(v)) continue;
      if (name.endsWith("_host") && !v.includes(own.split(".")[0])) continue;
      hits.add(v);
    }
    if (hits.size) {
      const list = [...hits].slice(0, 3);
      f.push({
        path: `discovered.${name}`, value: list.join(","), sourceUrl: url,
        confidence: list.length === 1 ? 0.9 : 0.6,
        quote: quote(why, 80),
      });
    }
  }
  return f;
}

export const UNIVERSAL_ADAPTERS: readonly Adapter[] = [
  {
    /*
     * The careers page, read ONLY for handles.
     *
     * A homepage links the product; the job board is linked from /careers.
     * Verified against three companies: linear.app -> jobs.ashbyhq.com/linear,
     * notion.so -> jobs.ashbyhq.com/notion, vercel.com ->
     * job-boards.greenhouse.io/vercel. Reading the token off their own page is
     * evidence; guessing it from the company name is how one company's hiring
     * gets attributed to another.
     */
    kind: "discover.careers",
    module: "0. Discovery",
    label: "Careers page handle discovery",
    cadence: "weekly", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/careers`,
    rate: { minIntervalMs: 2000 },
    maxBytes: 6_000_000,
    timeoutMs: 10_000,
    extract: (_b, { raw, url, company }) => scanHandles(raw, url, company.domain),
  },
  {
    kind: "discover",
    module: "0. Discovery",
    label: "Homepage handle discovery",
    cadence: "weekly", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/`,
    rate: { minIntervalMs: 2000 },
    maxBytes: 6_000_000,
    extract: (_b, { raw, url, company }) => {
      const f: Fact[] = [];
      const own = company.domain.replace(/^www\./, "");

      for (const [name, re, why] of HANDLE_PATTERNS) {
        const hits = new Set<string>();
        for (const m of raw.matchAll(re)) {
          const v = (m[1] ?? "").trim().replace(/\/$/, "");
          if (!v || v.length > 60 || JUNK_HANDLE.test(v)) continue;
          // A docs/status host on someone else's domain is not theirs.
          if (name.endsWith("_host") && !v.includes(own.split(".")[0])) continue;
          hits.add(v);
        }
        if (hits.size) {
          const list = [...hits].slice(0, 3);
          f.push({
            path: `discovered.${name}`, value: list.join(","), sourceUrl: url,
            // Several candidates means we guessed; one is good evidence.
            confidence: list.length === 1 ? 0.9 : 0.6,
            quote: quote(why, 80),
          });
        }
      }

      // Social and legal surfaces worth knowing exist, cheaply.
      const has = (re: RegExp) => re.test(raw);
      f.push({ path: "discovered.handles_found", value: f.length, sourceUrl: url, confidence: 1 });
      if (has(/\/(trust|security)(\/|")/i)) f.push({ path: "discovered.trust_page", value: true, sourceUrl: url, confidence: 0.7 });
      if (has(/\bsoc\s?2\b|iso\s?27001|hipaa|gdpr/i)) {
        f.push({ path: "discovered.compliance_claims", value: true, sourceUrl: url, confidence: 0.7 });
      }
      return f;
    },
  },

  // ---- sitemap: structure, and where new sections show up first ---------
  {
    kind: "sitemap",
    module: "4. Unannounced signals",
    label: "sitemap.xml",
    cadence: "daily", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/sitemap.xml`,
    rate: { minIntervalMs: 2000 },
    maxBytes: 20_000_000,
    extract: (_b, { raw, url, company }) => {
      const locs = [...raw.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
      if (!locs.length) return [];

      // A sitemap index points at more sitemaps; say so rather than reporting
      // a handful of URLs as if that were the whole site.
      const isIndex = /<sitemapindex/i.test(raw);
      const f: Fact[] = [
        // Competitors the company names in its own comparison URLs. The
        // sitemap is already in hand, so this costs nothing.
        ...competitorFacts(locs, company.domain, url),
        // Integration catalogue, from the same sitemap. Also free.
        ...ecosystemFacts(locs, company.domain, url),
        { path: "site.sitemap.urls", value: locs.length, sourceUrl: url, confidence: 1 },
        { path: "site.sitemap.is_index", value: isIndex, sourceUrl: url, confidence: 1 },
      ];

      // Top-level sections: a NEW section is a new product line or market.
      const sections = new Map<string, number>();
      for (const l of locs) {
        try {
          const seg = new URL(l).pathname.split("/").filter(Boolean)[0];
          if (seg && seg.length < 40) sections.set(seg, (sections.get(seg) ?? 0) + 1);
        } catch { /* a malformed loc is not worth a failure */ }
      }
      const ranked = [...sections.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length) {
        f.push({ path: "site.sections", value: ranked.slice(0, 40).map(([s]) => s).sort().join(","), sourceUrl: url, confidence: 1 });
        f.push({ path: "site.sections.count", value: ranked.length, sourceUrl: url, confidence: 1 });
      }
      /*
       * Locale paths: /de/, /fr-fr/ — a new one is a market entry.
       *
       * The language subtag is checked against ISO 639-1, because a bare
       * two-letter path segment is NOT a locale. GitLab's sitemap gave us
       * "ai, ci, ci-cd, dd, fe, go, kb, pb, pq, ux" as markets — those are
       * product and docs pages, and /ai/ read as Anguilla is precisely the
       * kind of confident nonsense this product exists to avoid.
       */
      const locales = new Set(locs.flatMap((l) => {
        const m = l.match(/\/([a-z]{2})(?:-([a-z]{2}))?\//i);
        if (!m) return [];
        const lang = m[1].toLowerCase();
        if (!ISO_639_1.has(lang)) return [];
        // Bare `en` is the default language and says nothing about markets,
        // but `en-gb` and `en-sg` name specific ones — Adyen publishes
        // en_AE, en_AU, en_GB, en_IN and en_SG, which is its market map.
        if (!m[2]) return lang === "en" ? [] : [lang];
        return [`${lang}-${m[2].toLowerCase()}`];
      }));
      if (locales.size) {
        f.push({ path: "geo.locales", value: [...locales].sort().join(","), sourceUrl: url, confidence: 0.7 });
      }
      return f;
    },
  },

  // ---- GLEIF: legal entities, keyless, worldwide ------------------------
  {
    /**
     * Works for ANY legal entity, which is exactly what the tech-shaped sources
     * do not. Name matching is the catch: querying "GPE" returned 180 entities
     * across the Caymans and France, so a candidate is only accepted on a
     * strong name match and the confidence says how strong.
     */
    kind: "corporate.gleif",
    module: "14. Corporate",
    label: "GLEIF legal entity registry",
    cadence: "monthly", tier: "A", format: "json",
    url: (c) => {
      const name = c.name?.trim();
      if (!name || name.length < 4) return null; // a 3-letter name matches everything
      return `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=${encodeURIComponent(name)}&page%5Bsize%5D=10`;
    },
    rate: { minIntervalMs: 1500 },
    extract: (b, { company, url }) => {
      const recs = asObjArr<{ attributes?: unknown }>(asObj<{ data?: unknown }>(b).data);
      if (!recs.length) return [];

      const norm = (s: string) => s.toLowerCase().replace(/\b(plc|p l c|ltd|limited|inc|llc|gmbh|sa|nv|bv|ag|corp|corporation|company|co|group|holdings?)\b/g, "").replace(/[^a-z0-9]/g, "");
      const want = norm(company.name ?? "");

      type Attr = { lei?: string; entity?: { legalName?: { name?: string }; status?: string; legalAddress?: { country?: string }; legalForm?: { id?: string }; creationDate?: string } };
      const scored = recs
        .map((r) => asObj<Attr>(r.attributes))
        .map((a) => {
          const nm = asObj<{ name?: string }>(asObj<NonNullable<Attr["entity"]>>(a.entity).legalName).name ?? "";
          const got = norm(nm);
          /*
           * EXACT normalised match only.
           *
           * This used to accept a prefix match at 0.75 confidence, which is
           * how linear.app acquired the legal identity of "Linear Consulting",
           * a Belgian company incorporated in October 2025: GLEIF's name
           * filter returns every entity whose name merely contains the term —
           * LINEAR ENTERPRISES, LINEAR S.R.L., THE LINEAR TRUST — and
           * "linearconsulting".startsWith("linear") is true.
           *
           * A shared first word is not evidence of identity. Publishing
           * another company's incorporation date and country as this
           * company's is worse than publishing nothing, so a near-miss now
           * resolves to "not matched" and emits no legal name at all.
           */
          return { a, nm, score: got === want && got.length > 0 ? 1 : 0 };
        })
        .filter((x) => x.score > 0);

      if (!scored.length) {
        return [
          { path: "corporate.gleif.matched", value: false, sourceUrl: url, confidence: 1 },
          // How many near-misses there were, so the gap is visibly "we could
          // not tell which" rather than "the registry has nothing".
          { path: "corporate.gleif.candidates", value: recs.length, sourceUrl: url, confidence: 1 },
        ];
      }
      const best = scored[0];
      const e = asObj<NonNullable<Attr["entity"]>>(best.a.entity);

      const countryOf = (x: typeof best) =>
        asObj<{ country?: string }>(asObj<NonNullable<Attr["entity"]>>(x.a.entity).legalAddress).country ?? null;

      /*
       * RESOLUTION, in three outcomes rather than two.
       *
       * GLEIF's filter is a contains-search returning up to ten entities, so
       * "Stripe" yields a Belgian company literally named STRIPE while the
       * real Stripe, Inc. falls off the truncated page entirely. Taking the
       * exact match put Belgium and a 2007 incorporation date on Stripe's
       * page. Refusing every multi-candidate result instead threw away ~50
       * correct resolutions, including Gymshark and Great Portland Estates.
       *
       * Neither extreme is right, because a name match alone genuinely cannot
       * separate them. So the match is CORROBORATED where possible, and
       * demoted to an explicitly unverified lead where it is not:
       *
       *   1. One exact match, and nothing else returned → sound.
       *   2. Several exact matches all in ONE country → one group sharing a
       *      registered name (GYMSHARK LTD and GYMSHARK GROUP LIMITED, both
       *      GB). Take the shortest name and report the rest as related.
       *   3. One exact match whose country agrees with the ccTLD → sound.
       *      `gpe.co.uk` matching a GB entity is corroboration; `.com` is not.
       *   4. Anything else → a candidate, at low confidence, under its own
       *      paths. It never reaches the headline identity or the map.
       */
      const exactCountries = new Set(scored.map(countryOf).filter(Boolean));
      const oneGroup = scored.length > 1 && exactCountries.size === 1;
      const hint = tldCountry(company.domain);
      const corroborated = hint !== null && countryOf(best) === hint;
      const soleCandidate = recs.length === 1;

      const sound = soleCandidate || oneGroup || corroborated;

      if (!sound) {
        return [
          { path: "corporate.gleif.matched", value: true, sourceUrl: url, confidence: 1 },
          { path: "corporate.gleif.ambiguous", value: true, sourceUrl: url, confidence: 1 },
          { path: "corporate.gleif.candidates", value: recs.length, sourceUrl: url, confidence: 1 },
          /*
           * Deliberately NOT `corporate.legal_name` or `geo.legal_country`.
           * Those feed the page headline and the map, and an unverified name
           * match has no business in either. Under their own `candidate_`
           * paths they are a lead a reader can check, which is useful and
           * honest; promoted, they would be a fabricated identity.
           */
          { path: "corporate.gleif.candidate_name", value: best.nm, sourceUrl: url, confidence: 0.4, quote: quote(best.nm, 120) },
          { path: "corporate.gleif.candidate_country", value: countryOf(best), sourceUrl: url, confidence: 0.4 },
          { path: "corporate.gleif.candidate_lei", value: best.a.lei ?? null, sourceUrl: url, confidence: 0.4 },
        ];
      }

      // In a one-group result the shortest exact name is the parent, not an
      // employee-benefit vehicle with a longer name.
      if (oneGroup) scored.sort((x, y) => x.nm.length - y.nm.length);

      // A sound resolution: report the filing data at full confidence.
      const chosen = scored[0];
      const ent = asObj<NonNullable<Attr["entity"]>>(chosen.a.entity);
      const f: Fact[] = [
        { path: "corporate.gleif.matched", value: true, sourceUrl: url, confidence: 1 },
        { path: "corporate.gleif.lei", value: chosen.a.lei ?? null, sourceUrl: url, confidence: 1, quote: quote(chosen.nm, 120) },
        { path: "corporate.legal_name", value: chosen.nm, sourceUrl: url, confidence: 1, quote: quote(chosen.nm, 120) },
        { path: "corporate.gleif.basis", value: soleCandidate ? "sole-candidate" : oneGroup ? "single-country-group" : "cctld-corroborated", sourceUrl: url, confidence: 1 },
      ];
      if (ent.status) f.push({ path: "corporate.status", value: ent.status, sourceUrl: url, confidence: 1 });
      const country = asObj<{ country?: string }>(ent.legalAddress).country;
      if (country) f.push({ path: "geo.legal_country", value: country, sourceUrl: url, confidence: 1 });
      if (ent.creationDate) f.push({ path: "corporate.incorporated_at", value: ent.creationDate, sourceUrl: url, confidence: 1 });
      if (scored.length > 1) {
        f.push({ path: "corporate.related_entities", value: scored.length - 1, sourceUrl: url, confidence: 0.8 });
      }
      return f;
    },
  },

  // ---- Wayback: domain age -----------------------------------------------
  {
    kind: "history.wayback",
    module: "13. Attention & demand",
    label: "Internet Archive (domain age)",
    cadence: "monthly", tier: "A", format: "json",
    // Hard-capped elsewhere at 1 req/s; monthly cadence keeps us well inside it.
    url: (c) => `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(c.domain)}&output=json&limit=1&fastLatest=false&filter=statuscode:200`,
    rate: { minIntervalMs: 1500 },
    timeoutMs: 25_000,
    extract: (b, { url }) => {
      const rows = asArr<unknown>(b).filter(Array.isArray) as string[][];
      // Row 0 is the CDX header, not data.
      const data = rows.slice(1);
      if (!data.length) return [];
      const stamp = data[0]?.[1];
      if (!stamp || stamp.length < 8) return [];
      const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
      const years = Math.floor((Date.now() - Date.parse(iso)) / (365.25 * 86_400_000));
      return [
        { path: "history.first_archived", value: iso, sourceUrl: url, confidence: 0.9 },
        // Incumbency a startup cannot fake. gpe.co.uk goes back to 1999.
        { path: "history.domain_age_years", value: years, sourceUrl: url, confidence: 0.9 },
      ];
    },
  },
] as const;
