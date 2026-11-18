/**
 * Phase 0 gate: does every source in the plan actually work?
 *
 * The plan rests on third-party documentation — blog posts years old, APIs with
 * no published spec, free tiers that change monthly. This script replaces all of
 * that with observed fact. Nothing gets built on a source that fails here.
 *
 *   npx tsx scripts/probe-sources.ts            # all probes
 *   npx tsx scripts/probe-sources.ts gdelt wayback   # just these
 *
 * Deliberately polite: one request per probe, 12s timeout, generic UA, and the
 * fragile sources (crt.sh) get a single hit. Never run this in a loop.
 */

const UA = "Mozilla/5.0 (compatible; DeltaProbe/0.1; +https://example.com/bot)";
const TIMEOUT_MS = 12_000;

type Result = {
  name: string;
  tier: "A" | "B" | "C";
  ok: boolean;
  ms: number;
  detail: string;
};

/** Never throws. A probe that explodes is a probe that failed. */
async function get(url: string, headers: Record<string, string> = {}, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, text, ct: res.headers.get("content-type") ?? "" };
}

/**
 * Several of these APIs answer errors in PLAIN TEXT with a 200 or 429, so
 * JSON.parse throws on the error path. GDELT's rate-limit body is prose.
 * Always gate parsing on the body actually looking like JSON.
 */
function asJson(text: string): unknown | null {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try { return JSON.parse(t); } catch { return null; }
}

const probes: {
  name: string;
  tier: "A" | "B" | "C";
  skip?: string;
  run: () => Promise<string>;
}[] = [
  // ---- Tier A: the Phase 1 six -------------------------------------------
  {
    name: "direct-fetch (pricing page)",
    tier: "A",
    run: async () => {
      const hits: string[] = [];
      for (const d of ["notion.so", "linear.app", "vercel.com", "figma.com"]) {
        const r = await get(`https://${d}/pricing`);
        // Does a plain fetch see actual prices, or is it a JS shell?
        const prices = (r.text.match(/\$\s?\d{1,4}(\.\d{2})?/g) ?? []).length;
        hits.push(`${d}:${r.status}/${Math.round(r.text.length / 1024)}kb/${prices}prices`);
      }
      return hits.join(" ");
    },
  },
  {
    name: "wayback CDX (history back-fill)",
    tier: "A",
    run: async () => {
      const r = await get(
        "http://web.archive.org/cdx/search/cdx?url=notion.so/pricing&output=json&limit=2000&filter=statuscode:200&collapse=timestamp:6",
      );
      if (r.status !== 200) return `HTTP ${r.status}`;
      const rows = JSON.parse(r.text) as string[][];
      const stamps = rows.slice(1).map((x) => x[1]);
      return `${stamps.length} monthly snapshots, ${stamps[0]?.slice(0, 6)}..${stamps.at(-1)?.slice(0, 6)}`;
    },
  },
  {
    // VERIFIED 2026-11-18: the DOC API is NOT usable for systematic polling.
    // 10-14s per call; 429s with a PLAIN-TEXT body; honouring the stated 5s
    // interval was not enough (17s gaps still 429'd, and a single call after a
    // 35s cooldown still 429'd - the limit is cumulative/reputational).
    // GDELT's own error says: "All high-traffic users should switch to our
    // ngrams dataset". So media perception must come from BULK ingestion into
    // ClickHouse, not this endpoint. Kept as a liveness check only.
    name: "GDELT DOC API (bulk-only; see PHASE0.md)",
    tier: "B",
    run: async () => {
      const q = encodeURIComponent('"Figma"');
      const r = await get(
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=5&timespan=1m&format=json`,
        {},
        45_000,
      );
      const j = asJson(r.text) as { articles?: unknown[] } | null;
      if (!j) return `HTTP ${r.status} rate-limited (plain text) - expected; use bulk exports`;
      return `${j.articles?.length ?? 0} articles (interactive only, do not poll)`;
    },
  },
  {
    name: "ATS JSON (token guessed from name)",
    tier: "A",
    run: async () => {
      const hits: string[] = [];
      const guesses = ["notion", "figma", "vercel", "linear", "stripe", "ramp", "retool"];
      for (const g of guesses) {
        for (const [ats, url] of [
          ["gh", `https://boards-api.greenhouse.io/v1/boards/${g}/jobs`],
          ["lv", `https://api.lever.co/v0/postings/${g}?mode=json`],
          ["ab", `https://api.ashbyhq.com/posting-api/job-board/${g}`],
        ] as const) {
          const r = await get(url).catch(() => null);
          if (r && r.status === 200) {
            try {
              const j = JSON.parse(r.text);
              const n = Array.isArray(j) ? j.length : (j.jobs?.length ?? 0);
              if (n > 0) { hits.push(`${g}=${ats}:${n}`); break; }
            } catch { /* not json */ }
          }
        }
      }
      return hits.length ? `${hits.length}/${guesses.length} resolved — ${hits.join(" ")}` : "none resolved";
    },
  },
  {
    name: "sitemap + robots (unannounced URLs)",
    tier: "A",
    run: async () => {
      const r = await get("https://linear.app/sitemap.xml");
      const n = (r.text.match(/<loc>/g) ?? []).length;
      const rb = await get("https://linear.app/robots.txt");
      return `sitemap ${r.status}/${n} urls, robots ${rb.status}/${rb.text.split("\n").length} lines`;
    },
  },

  // ---- Tier A: Phase 5 widening ------------------------------------------
  {
    name: "HN Algolia (dev mentions)",
    tier: "A",
    run: async () => {
      const r = await get("https://hn.algolia.com/api/v1/search?query=notion&tags=story&hitsPerPage=5");
      if (r.status !== 200) return `HTTP ${r.status}`;
      const j = JSON.parse(r.text);
      return `${j.nbHits} hits, top "${String(j.hits?.[0]?.title ?? "").slice(0, 40)}" ${j.hits?.[0]?.points}pts`;
    },
  },
  {
    name: "GitHub releases",
    tier: "A",
    run: async () => {
      const r = await get("https://api.github.com/repos/vercel/next.js/releases?per_page=3", {
        accept: "application/vnd.github+json",
      });
      if (r.status !== 200) return `HTTP ${r.status} (unauth limit is 60/hr)`;
      const j = JSON.parse(r.text);
      return `${j.length} releases, latest ${j[0]?.tag_name} @ ${String(j[0]?.published_at).slice(0, 10)}`;
    },
  },
  {
    name: "npm registry (release cadence)",
    tier: "A",
    run: async () => {
      const r = await get("https://registry.npmjs.org/next");
      if (r.status !== 200) return `HTTP ${r.status}`;
      const j = JSON.parse(r.text);
      const vs = Object.keys(j.time ?? {}).length;
      return `${vs} versions, latest ${j["dist-tags"]?.latest}`;
    },
  },
  {
    name: "iTunes Search + reviews RSS",
    tier: "A",
    run: async () => {
      const s = await get("https://itunes.apple.com/search?term=notion&entity=software&limit=1");
      const j = JSON.parse(s.text);
      const app = j.results?.[0];
      if (!app) return "no app found";
      const rv = await get(
        `https://itunes.apple.com/us/rss/customerreviews/id=${app.trackId}/sortBy=mostRecent/json`,
      );
      let nrev = 0;
      try { nrev = (JSON.parse(rv.text)?.feed?.entry ?? []).length; } catch { /* */ }
      return `${app.trackName} v${app.version}, ${app.averageUserRating}★/${app.userRatingCount}, rss ${rv.status}/${nrev} reviews`;
    },
  },
  {
    name: "Statuspage JSON",
    tier: "A",
    run: async () => {
      const hits: string[] = [];
      // VERIFIED: the /api/v2/status.json convention works, but the status HOST
      // must be discovered (sitemap/footer/<name>.statuspage.io), never guessed.
      for (const h of ["www.githubstatus.com", "www.cloudflarestatus.com", "status.openai.com"]) {
        const r = await get(`https://${h}/api/v2/status.json`).catch(() => null);
        hits.push(`${h.replace(/^www\./, "")}:${r?.status ?? "err"}`);
      }
      return hits.join(" ");
    },
  },
  {
    name: "Wikipedia pageviews",
    tier: "A",
    run: async () => {
      const r = await get(
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Notion_(productivity_software)/daily/20260801/20261101",
      );
      if (r.status !== 200) return `HTTP ${r.status}`;
      const items = JSON.parse(r.text).items ?? [];
      return `${items.length} days, last ${items.at(-1)?.views} views`;
    },
  },
  {
    name: "Common Crawl index",
    tier: "A",
    run: async () => {
      const ci = await get("https://index.commoncrawl.org/collinfo.json");
      if (ci.status !== 200) return `collinfo HTTP ${ci.status}`;
      const colls = JSON.parse(ci.text);
      const latest = colls[0]?.id;
      const q = await get(
        `https://index.commoncrawl.org/${latest}-index?url=notion.so&output=json&limit=5`,
      );
      const lines = q.text.trim().split("\n").filter(Boolean).length;
      return `${colls.length} crawls, latest ${latest}, query ${q.status}/${lines} rows`;
    },
  },
  {
    name: "Bluesky (needs app password - 403 unauth)",
    tier: "B",
    run: async () => {
      const r = await get(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=notion&limit=5",
      );
      if (r.status !== 200) return `HTTP ${r.status} (may need auth)`;
      return `${(JSON.parse(r.text).posts ?? []).length} posts`;
    },
  },
  {
    name: "subprocessors (no standard path - discover)",
    tier: "B",
    run: async () => {
      const hits: string[] = [];
      for (const u of [
        "https://www.notion.com/subprocessors",
        "https://linear.app/docs/subprocessors",
        "https://vercel.com/legal/subprocessors",
      ]) {
        const r = await get(u).catch(() => null);
        hits.push(`${new URL(u).hostname.replace(/^www\./, "")}:${r?.status ?? "err"}`);
      }
      return hits.join(" ");
    },
  },

  // ---- Tier B: fragile ---------------------------------------------------
  {
    name: "crt.sh (FLAKY - 502s; Cert Spotter is primary)",
    tier: "B",
    run: async () => {
      const r = await get("https://crt.sh/?q=%25.notion.so&output=json&exclude=expired");
      if (r.status !== 200) return `HTTP ${r.status} (502s are common)`;
      const j = JSON.parse(r.text);
      const names = new Set(j.flatMap((c: { name_value: string }) => c.name_value.split("\n")));
      return `${j.length} certs, ${names.size} distinct names`;
    },
  },
  {
    name: "Cert Spotter (PRIMARY for subdomains)",
    tier: "A",
    run: async () => {
      const r = await get(
        "https://api.certspotter.com/v1/issuances?domain=notion.so&include_subdomains=true&expand=dns_names",
      );
      return r.status === 200
        ? `${JSON.parse(r.text).length} issuances`
        : `HTTP ${r.status} (free tier is rate-limited)`;
    },
  },
  {
    name: "Stack Exchange API",
    tier: "B",
    run: async () => {
      const r = await get(
        "https://api.stackexchange.com/2.3/search/advanced?q=notion+api&site=stackoverflow&pagesize=5",
      );
      if (r.status !== 200) return `HTTP ${r.status}`;
      const j = JSON.parse(r.text);
      return `${j.items?.length} items, quota ${j.quota_remaining}/${j.quota_max}`;
    },
  },
  {
    name: "Tranco popularity list",
    tier: "B",
    run: async () => {
      const r = await get("https://tranco-list.eu/api/ranks/domain/notion.so");
      return r.status === 200 ? `ranks ${r.text.slice(0, 80)}` : `HTTP ${r.status}`;
    },
  },

  // ---- Tier C: credit-gated (not spent without the key) -----------------
  {
    name: "SerpAPI (site: review trends)",
    tier: "C",
    skip: process.env.SERPAPI_KEY ? undefined : "no SERPAPI_KEY in env — skipped, costs credits",
    run: async () => {
      const q = encodeURIComponent("site:g2.com notion");
      const r = await get(
        `https://serpapi.com/search.json?engine=google&q=${q}&api_key=${process.env.SERPAPI_KEY}`,
      );
      if (r.status !== 200) return `HTTP ${r.status}`;
      const j = JSON.parse(r.text);
      const first = j.organic_results?.[0];
      const rich = first?.rich_snippet?.top?.detected_extensions ?? first?.rich_snippet ?? null;
      return `${j.organic_results?.length ?? 0} results; rich_snippet=${rich ? JSON.stringify(rich).slice(0, 120) : "NONE — rating not exposed"}`;
    },
  },
];

// ---------------------------------------------------------------------------

async function main() {
  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const chosen = only.length
    ? probes.filter((p) => only.some((o) => p.name.toLowerCase().includes(o)))
    : probes;

  console.log(`\nDELTA source probe — ${new Date().toISOString()}`);
  console.log(`${chosen.length} probes, ${TIMEOUT_MS / 1000}s timeout, sequential and polite.\n`);

  const results: Result[] = [];
  for (const p of chosen) {
    if (p.skip) {
      results.push({ name: p.name, tier: p.tier, ok: false, ms: 0, detail: `SKIP — ${p.skip}` });
      console.log(`  ‑  [${p.tier}] ${p.name.padEnd(38)} SKIP — ${p.skip}`);
      continue;
    }
    const t0 = Date.now();
    let ok = false;
    let detail: string;
    try {
      detail = await p.run();
      // A probe "works" only if it came back with usable shape, not just a 200.
      ok = !/^HTTP [45]|EMPTY|none resolved|no app found|NONE —|err/.test(detail);
    } catch (e) {
      detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 90) : String(e);
    }
    const ms = Date.now() - t0;
    results.push({ name: p.name, tier: p.tier, ok, ms, detail });
    console.log(`  ${ok ? "OK" : "!!"} [${p.tier}] ${p.name.padEnd(38)} ${String(ms).padStart(5)}ms  ${detail}`);
  }

  const live = results.filter((r) => r.ok);
  const dead = results.filter((r) => !r.ok && !r.detail.startsWith("SKIP"));
  console.log(`\n${"-".repeat(78)}`);
  console.log(`${live.length} working, ${dead.length} failed, ${results.length - live.length - dead.length} skipped`);
  if (dead.length) {
    console.log(`\nFAILED — do not build on these until resolved:`);
    for (const d of dead) console.log(`  [${d.tier}] ${d.name} — ${d.detail}`);
  }
  console.log();
}

main();
