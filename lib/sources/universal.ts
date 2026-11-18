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

export const UNIVERSAL_ADAPTERS: readonly Adapter[] = [
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
    extract: (_b, { raw, url }) => {
      const locs = [...raw.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
      if (!locs.length) return [];

      // A sitemap index points at more sitemaps; say so rather than reporting
      // a handful of URLs as if that were the whole site.
      const isIndex = /<sitemapindex/i.test(raw);
      const f: Fact[] = [
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
      // Locale paths: /de/, /fr-fr/ — a new one is a market entry.
      const locales = new Set(locs.flatMap((l) => {
        const m = l.match(/\/([a-z]{2}(?:-[a-z]{2})?)\//i);
        return m && m[1].toLowerCase() !== "en" ? [m[1].toLowerCase()] : [];
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

      /*
       * An exact name match is necessary but not sufficient.
       *
       * GLEIF's filter is a contains-search, so "Linear" returns ten entities.
       * If exactly one of them matches the name exactly, that is strong
       * evidence. If it matched exactly but nine other companies also carry
       * the term, the registry cannot tell us which one owns this domain —
       * name matching has run out of information, and the honest output is an
       * answer carrying its own doubt rather than a confident wrong one.
       *
       * Resolving these properly needs a second signal: a VAT ID verified
       * through VIES, or a national registry (Companies House, SEC EDGAR).
       * Until then the ambiguity is published, not hidden.
       */
      const ambiguous = recs.length > 1;
      const conf = ambiguous ? 0.8 : 1;
      const f: Fact[] = [
        { path: "corporate.gleif.lei", value: best.a.lei ?? null, sourceUrl: url, confidence: conf, quote: quote(best.nm, 120) },
        { path: "corporate.legal_name", value: best.nm, sourceUrl: url, confidence: conf, quote: quote(best.nm, 120) },
        { path: "corporate.gleif.matched", value: true, sourceUrl: url, confidence: 1 },
      ];
      if (ambiguous) {
        f.push({ path: "corporate.gleif.ambiguous", value: true, sourceUrl: url, confidence: 1 });
        f.push({ path: "corporate.gleif.candidates", value: recs.length, sourceUrl: url, confidence: 1 });
      }
      if (e.status) f.push({ path: "corporate.status", value: e.status, sourceUrl: url, confidence: conf });
      const country = asObj<{ country?: string }>(e.legalAddress).country;
      if (country) f.push({ path: "geo.legal_country", value: country, sourceUrl: url, confidence: conf });
      if (e.creationDate) f.push({ path: "corporate.incorporated_at", value: e.creationDate, sourceUrl: url, confidence: conf });
      // Several EXACT matches means subsidiaries or incentive vehicles sharing
      // a registered name, which is genuinely informative about group
      // structure. Near-misses are excluded above and never counted here.
      if (scored.length > 1) {
        f.push({ path: "corporate.related_entities", value: scored.length - 1, sourceUrl: url, confidence: 0.6 });
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
