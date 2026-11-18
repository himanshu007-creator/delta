/**
 * The source registry. Every adapter is DATA, not a module.
 *
 * Adding a source means adding an object here — url + extract — and it inherits
 * the shared fetcher, retry/Retry-After handling, content hashing, differ and
 * writer for free. That is what makes wide coverage affordable: ~20 lines per
 * source instead of a bespoke integration each.
 *
 * Every entry below was probed against live companies in Phase 0 — see
 * PHASE0.md for the observed response for each one. Nothing here is assumed.
 */

import { asArr, asObj, asObjArr, decodeEntities, num, quote, sum, type Adapter, type Company, type Fact } from "./types";
import { vendorFacts } from "./vendors";
import { extractPricing, pricingFacts } from "./pricing";
import { GITHUB_ADAPTERS } from "./github";
import { HEALTH_ADAPTERS } from "./health";
import { IDENTITY_ADAPTERS } from "./identity";
import { UNIVERSAL_ADAPTERS } from "./universal";

// --- shared extractors ------------------------------------------------------

/** Page <title>, for positioning diffs. */
const clean = (s: string | undefined): string | null => {
  if (!s) return null;
  const out = decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return out || null;
};

const title = (html: string): string | null =>
  clean(html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)?.[1]);

const h1 = (html: string): string | null =>
  clean(html.match(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i)?.[1]);

/** `llms.txt` is markdown: headings are the product's own feature taxonomy. */
function llmsFacts(md: string, url: string): Fact[] {
  const headings = [...md.matchAll(/^#{1,3}\s+(.{2,80})$/gm)].map((m) => m[1].trim());
  const links = (md.match(/\]\(https?:\/\//g) ?? []).length;
  const firstLine = md.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  return [
    { path: "product.llmstxt.present", value: true, sourceUrl: url, confidence: 1 },
    { path: "product.llmstxt.bytes", value: md.length, sourceUrl: url, confidence: 1 },
    { path: "product.llmstxt.sections", value: headings.length, sourceUrl: url, confidence: 1 },
    { path: "product.llmstxt.links", value: links, sourceUrl: url, confidence: 1 },
    { path: "product.llmstxt.outline", value: headings.join(" | ").slice(0, 4000), sourceUrl: url, confidence: 1 },
    ...(firstLine ? [{ path: "product.llmstxt.summary", value: quote(firstLine, 300), sourceUrl: url, confidence: 1, quote: quote(firstLine, 300) }] : []),
  ];
}

/** Jobs, across the three boards Phase 0 confirmed. Geography falls out free. */
function jobFacts(body: unknown, provider: string, url: string): Fact[] {
  type Row = { title: string; location: string; team: string };
  let rows: Row[] = [];

  if (provider === "greenhouse") {
    const j = asObj<{ jobs?: { title?: string; location?: { name?: string }; departments?: { name?: string }[] }[] }>(body);
    rows = asObjArr<{ title?: string; location?: { name?: string }; departments?: { name?: string }[] }>(j.jobs).map((x) => ({
      title: x.title ?? "", location: x.location?.name ?? "", team: asObjArr<{ name?: string }>(x.departments)[0]?.name ?? "",
    }));
  } else if (provider === "lever") {
    const j = asObjArr<{ text?: string; categories?: { location?: string; team?: string } }>(body);
    rows = j.map((x) => ({
      title: x.text ?? "", location: x.categories?.location ?? "", team: x.categories?.team ?? "",
    }));
  } else {
    const j = asObj<{ jobs?: { title?: string; location?: string; department?: string }[] }>(body);
    rows = asObjArr<{ title?: string; location?: string; department?: string }>(j.jobs).map((x) => ({ title: x.title ?? "", location: x.location ?? "", team: x.department ?? "" }));
  }

  const tally = (pick: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = pick(r).trim();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  // GEOGRAPHY, for zero extra requests: the location field is already here.
  // "12 new roles in Bangalore" is the India-expansion signal, and it costs
  // nothing beyond the fetch we were doing anyway.
  const byLoc = tally((r) => r.location);
  const byTeam = tally((r) => r.team);

  return [
    { path: "hiring.open_roles", value: rows.length, sourceUrl: url, confidence: 1 },
    { path: "hiring.locations.count", value: byLoc.length, sourceUrl: url, confidence: 1 },
    ...byLoc.slice(0, 40).map(([loc, n]): Fact => ({ path: `geo.hiring.${loc.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`, value: n, sourceUrl: url, confidence: 0.9, quote: quote(loc, 60) })),
    ...byTeam.slice(0, 25).map(([team, n]): Fact => ({ path: `hiring.team.${team.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`, value: n, sourceUrl: url, confidence: 0.9, quote: quote(team, 60) })),
  ];
}

const ATS_URL: Record<string, (t: string) => string> = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
};

// --- the registry -----------------------------------------------------------

export const ADAPTERS: readonly Adapter[] = [
  // Domain-only sources + handle discovery. These are what make an UNKNOWN
  // company worth a dossier, and discovery unlocks the rest of the catalog.
  ...UNIVERSAL_ADAPTERS,
  // Who the company actually IS — works for any website.
  ...IDENTITY_ADAPTERS,
  // The GitHub bundle: nine adapters, each independently hashed and cadenced.
  ...GITHUB_ADAPTERS,
  // Repo health, security posture, reliability history.
  ...HEALTH_ADAPTERS,
  // ---- Phase 1 spine ------------------------------------------------------
  {
    kind: "pricing", module: "2. Pricing", label: "Pricing page", cadence: "12h", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/pricing`,
    rate: { minIntervalMs: 2000 }, maxBytes: 6_000_000,
    // The 4-layer cascade in ./pricing.ts: JSON-LD > framework payload > text.
    // The visual layer (./visual.ts) is invoked separately, only for pages this
    // returns nothing for or flags as implausible, because it costs a
    // screenshot plus vision tokens.
    extract: (_b, { raw, url }) => pricingFacts(extractPricing(raw), url),
  },
  {
    // VERIFIED 14/18 adoption, byte-stable, 50 Wayback snapshots. The vendor's
    // own machine-readable product summary — and diffing it needs NO LLM.
    kind: "llmstxt", module: "3. Product & releases", label: "llms.txt", cadence: "12h", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/llms.txt`,
    rate: { minIntervalMs: 1000 },
    extract: (_b, { raw, url }) => llmsFacts(raw, url),
  },
  {
    kind: "home", module: "1. Positioning", label: "Homepage", cadence: "12h", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/`,
    rate: { minIntervalMs: 2000 }, maxBytes: 4_000_000,
    extract: (_b, { raw, url }) => {
      const t = title(raw), head = h1(raw);
      return [
        ...(t ? [{ path: "positioning.title", value: t, sourceUrl: url, confidence: 1, quote: quote(t) }] : []),
        ...(head ? [{ path: "positioning.h1", value: head, sourceUrl: url, confidence: 1, quote: quote(head) }] : []),
      ];
    },
  },
  {
    kind: "changelog", module: "3. Product & releases", label: "Changelog", cadence: "12h", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/changelog`,
    rate: { minIntervalMs: 2000 }, maxBytes: 4_000_000,
    extract: (_b, { raw, url }) => {
      // A 200 on /changelog is NOT proof of a changelog: automattic.com/changelog
      // returned a blog archive whose newest date was 2005, and reporting that
      // as "latest release" is worse than reporting nothing. So require both a
      // changelog-ish page and a date recent enough to be plausible.
      const looksLikeChangelog = /changelog|release notes|what&#?8217;?s new|what's new|版本/i.test(raw.slice(0, 20_000));
      const cutoff = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
      const dates = [...raw.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)]
        .map((m) => m[1])
        .filter((d) => d >= cutoff && d <= new Date().toISOString().slice(0, 10))
        .sort();
      if (!looksLikeChangelog && !dates.length) return [];
      return [
        // Only ASSERT presence when the page actually reads as a changelog.
        // Claiming `present: false` while also publishing a release date is a
        // self-contradiction, so in that case we report the date alone.
        ...(looksLikeChangelog ? [{ path: "product.changelog.present", value: true, sourceUrl: url, confidence: 1 }] : []),
        ...(dates.length ? [{ path: "product.changelog.latest_date", value: dates[dates.length - 1], sourceUrl: url, confidence: looksLikeChangelog ? 0.7 : 0.5 }] : []),
      ];
    },
  },
  {
    kind: "stack.dns", module: "7. Vendor & tech stack", label: "Public DNS TXT records", cadence: "daily", tier: "A", format: "dns-txt",
    url: (c) => c.domain, // the runner resolves TXT; no HTTP involved
    extract: (body, { company }) => vendorFacts(asArr<string[]>(body).map((r) => (Array.isArray(r) ? r.join("") : String(r))), company.domain),
  },
  {
    kind: "jobs", module: "5. Hiring & org", label: "Public job board (ATS)", cadence: "12h", tier: "A", format: "json",
    url: (c) => (c.ats ? ATS_URL[c.ats.provider](c.ats.token) : null),
    rate: { minIntervalMs: 1000 },
    maxBytes: 12_000_000, // observed: one board returned 3,083,751 bytes and was dropped
    extract: (b, { company, url }) => jobFacts(b, company.ats?.provider ?? "ashby", url),
  },

  // ---- Phase 2 breadth, same contract ------------------------------------
  {
    kind: "api.openapi", module: "3. Product & releases", label: "OpenAPI spec", cadence: "daily", tier: "A", format: "text",
    url: (c) => `https://${c.domain}/openapi.json`,
    maxBytes: 20_000_000, // vercel.com's is 12 MB
    extract: (_b, { raw, url }) => {
      const paths = [...raw.matchAll(/"(\/[a-z0-9{}\/_.-]{2,80})"\s*:\s*\{/gi)].map((m) => m[1]);
      const uniq = [...new Set(paths)].sort();
      // linear.app/openapi.json returned 200 but parsed to ZERO endpoints (it is
      // a GraphQL shop). Emitting `endpoints = 0` made a dead block look alive,
      // which is the worst failure mode there is. Say nothing instead.
      if (uniq.length === 0) return [];
      return [
        { path: "product.api.endpoints", value: uniq.length, sourceUrl: url, confidence: 0.8 },
        { path: "product.api.fingerprint", value: uniq.join(",").slice(0, 8000), sourceUrl: url, confidence: 0.8 },
      ];
    },
  },
  {
    kind: "adoption.npm", module: "11. Adoption & scale", label: "npm downloads", cadence: "daily", tier: "A", format: "json",
    url: (c) => (c.npm ? `https://api.npmjs.org/downloads/range/last-month/${c.npm}` : null),
    extract: (b, { url }) => {
      const d = asObjArr<{ downloads: number }>(asObj<{ downloads?: unknown }>(b).downloads);
      return [{ path: "adoption.npm.monthly", value: sum(d.map((x) => x.downloads)), sourceUrl: url, confidence: 1 }];
    },
  },
  {
    kind: "reviews.appstore", module: "10. Reviews & ratings", label: "App Store", cadence: "daily", tier: "A", format: "json",
    url: (c) => (c.appStoreId ? `https://itunes.apple.com/lookup?id=${c.appStoreId}` : null),
    extract: (b, { url }) => {
      const a = asObjArr<{ version?: string; averageUserRating?: number; userRatingCount?: number }>(asObj<{ results?: unknown }>(b).results)[0];
      return a
        ? [
            { path: "reviews.appstore.rating", value: a.averageUserRating ?? null, sourceUrl: url, confidence: 1 },
            { path: "reviews.appstore.count", value: a.userRatingCount ?? null, sourceUrl: url, confidence: 1 },
            { path: "product.appstore.version", value: a.version ?? null, sourceUrl: url, confidence: 1 },
          ]
        : [];
    },
  },
  {
    kind: "reviews.wordpress", module: "10. Reviews & ratings", label: "WordPress.org", cadence: "daily", tier: "A", format: "json",
    url: (c) => (c.wpSlug ? `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${c.wpSlug}` : null),
    extract: (b, { url }) => {
      const p = asObj<{ active_installs?: number; rating?: number; num_ratings?: number; version?: string }>(b);
      return [
        { path: "adoption.wordpress.installs", value: p.active_installs ?? null, sourceUrl: url, confidence: 1 },
        { path: "reviews.wordpress.rating", value: p.rating ?? null, sourceUrl: url, confidence: 1 },
        { path: "reviews.wordpress.count", value: p.num_ratings ?? null, sourceUrl: url, confidence: 1 },
      ];
    },
  },
  {
    kind: "attention.wikipedia", module: "13. Attention & demand", label: "Wikipedia pageviews", cadence: "daily", tier: "A", format: "json",
    url: (c) => {
      if (!c.wikipedia) return null;
      const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
      const start = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
      return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(c.wikipedia)}/daily/${start}/${end}`;
    },
    extract: (b, { url }) => {
      const items = asObjArr<{ views: number }>(asObj<{ items?: unknown }>(b).items);
      return items.length ? [{ path: "attention.wikipedia.views_30d", value: sum(items.map((i) => i.views)), sourceUrl: url, confidence: 1 }] : [];
    },
  },
  {
    kind: "attention.tranco", module: "13. Attention & demand", label: "Tranco rank", cadence: "weekly", tier: "B", format: "json",
    url: (c) => `https://tranco-list.eu/api/ranks/domain/${c.domain}`,
    timeoutMs: 20_000, // observed 9.4s in Phase 0
    extract: (b, { url }) => {
      const r = asObjArr<{ date: string; rank: number }>(asObj<{ ranks?: unknown }>(b).ranks)[0];
      return r ? [{ path: "attention.tranco.rank", value: r.rank, sourceUrl: url, confidence: 1 }] : [];
    },
  },
  {
    // Cert Spotter, not crt.sh: Phase 0 showed crt.sh 502s then times out.
    // Tier B, not A: Phase 0 saw 100 issuances in 3.5s, but verification saw
    // 34.5s then a failure on a larger domain. Must degrade silently.
    kind: "signals.certs", module: "4. Unannounced signals", label: "Certificate Transparency", cadence: "weekly", tier: "B", format: "json",
    url: (c) => `https://api.certspotter.com/v1/issuances?domain=${c.domain}&include_subdomains=true&expand=dns_names`,
    rate: { minIntervalMs: 5000 }, timeoutMs: 15_000, attempts: 1,
    extract: (b, { company, url }) => {
      const names = new Set<string>();
      for (const i of asObjArr<{ dns_names?: string[] }>(b)) for (const n of asArr<string>(i.dns_names)) {
        if (n.endsWith(company.domain) && !n.startsWith("*")) names.add(n.toLowerCase());
      }
      const sorted = [...names].sort();
      return [
        { path: "signals.subdomains.count", value: sorted.length, sourceUrl: url, confidence: 1 },
        { path: "signals.subdomains.list", value: sorted.join(",").slice(0, 8000), sourceUrl: url, confidence: 1 },
      ];
    },
  },
] as const;

export const byKind = (kind: string): Adapter | undefined => ADAPTERS.find((a) => a.kind === kind);
export const adaptersFor = (c: Company): Adapter[] => ADAPTERS.filter((a) => a.url(c) !== null);

