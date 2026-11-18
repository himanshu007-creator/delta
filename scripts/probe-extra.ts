/**
 * Phase 0b: candidate sources NOT yet in the plan. Verify before promising.
 * Same discipline as probe-sources.ts — observed fact only.
 *   npx tsx scripts/probe-extra.ts
 */
const UA = "Mozilla/5.0 (compatible; DeltaProbe/0.1; +https://example.com/bot)";
const T = 15_000;

async function get(url: string, h: Record<string, string> = {}, ms = T) {
  const r = await fetch(url, { headers: { "user-agent": UA, ...h }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  return { status: r.status, text: await r.text() };
}
function j(text: string): any | null {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try { return JSON.parse(t); } catch { return null; }
}

const probes: { name: string; why: string; run: () => Promise<string> }[] = [
  {
    name: "USPTO trademarks",
    why: "unannounced PRODUCT NAMES before launch",
    run: async () => {
      const r = await get("https://developer.uspto.gov/ibd-api/v1/application/publications?searchText=notion&rows=1");
      if (r.status !== 200) {
        const r2 = await get("https://tmsearch.uspto.gov/api-v1-0-0/tmsearch/select?q=notion&rows=1");
        return `ibd-api ${r.status}, tmsearch ${r2.status} — needs the newer Open Data API + key`;
      }
      return `200, ${j(r.text)?.recordTotalQuantity ?? "?"} records`;
    },
  },
  {
    name: "SEC EDGAR full-text",
    why: "every filing mentioning a competitor; XBRL financials",
    run: async () => {
      const r = await get('https://efts.sec.gov/LATEST/search-index?q=%22Notion%20Labs%22&forms=10-K', { accept: "application/json" });
      const r2 = await get("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=stripe&type=10-K&output=atom");
      return `efts ${r.status}; browse-edgar ${r2.status}/${Math.round(r2.text.length / 1024)}kb`;
    },
  },
  {
    name: "npm download trends",
    why: "adoption curve for devtool competitors",
    run: async () => {
      const r = await get("https://api.npmjs.org/downloads/range/last-month/next");
      const d = j(r.text);
      if (!d?.downloads) return `HTTP ${r.status}`;
      const tot = d.downloads.reduce((a: number, x: { downloads: number }) => a + x.downloads, 0);
      return `${d.downloads.length} days, ${(tot / 1e6).toFixed(1)}M downloads/mo`;
    },
  },
  {
    name: "pypistats",
    why: "same for Python competitors",
    run: async () => {
      const r = await get("https://pypistats.org/api/packages/requests/recent");
      const d = j(r.text);
      return d?.data ? `last_month=${d.data.last_month?.toLocaleString()}` : `HTTP ${r.status}`;
    },
  },
  {
    name: "WordPress.org plugin API",
    why: "OFFICIAL active installs + ratings + changelog",
    run: async () => {
      const r = await get("https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=woocommerce");
      const d = j(r.text);
      if (!d) return `HTTP ${r.status}`;
      return `${d.name}: ${d.active_installs?.toLocaleString()} installs, ${d.rating}/100 from ${d.num_ratings} ratings, v${d.version}`;
    },
  },
  {
    name: "Firefox AMO API",
    why: "OFFICIAL extension users + ratings + version history",
    run: async () => {
      const r = await get("https://addons.mozilla.org/api/v5/addons/addon/grammarly-1/");
      const d = j(r.text);
      if (!d) return `HTTP ${r.status}`;
      return `${d.average_daily_users?.toLocaleString()} daily users, ${d.ratings?.average}★/${d.ratings?.count}`;
    },
  },
  {
    name: "Chrome Web Store",
    why: "extension users + ratings",
    run: async () => {
      const r = await get("https://chromewebstore.google.com/detail/grammarly-ai-writing-assi/kbfnbcaeplbcioakkpcpgfkobkghlhen");
      const users = r.text.match(/([\d,]+)\s*users/i)?.[1];
      const rating = r.text.match(/([\d.]+)\s*out of 5/i)?.[1];
      return r.status === 200 ? `200, users=${users ?? "not in HTML"} rating=${rating ?? "n/a"} (scrape, no API)` : `HTTP ${r.status}`;
    },
  },
  {
    name: "ATS: SmartRecruiters",
    why: "widen job coverage past Greenhouse/Lever/Ashby",
    run: async () => {
      const hits: string[] = [];
      for (const c of ["Ubisoft", "Bosch", "Visa"]) {
        const r = await get(`https://api.smartrecruiters.com/v1/companies/${c}/postings?limit=1`);
        const d = j(r.text);
        if (d?.totalFound) hits.push(`${c}:${d.totalFound}`);
      }
      return hits.length ? hits.join(" ") : "none resolved";
    },
  },
  {
    name: "ATS: Workable",
    why: "same",
    run: async () => {
      const hits: string[] = [];
      for (const c of ["loom", "deel", "miro"]) {
        const r = await get(`https://apply.workable.com/api/v3/accounts/${c}/jobs`, { "content-type": "application/json" });
        const d = j(r.text);
        if (d?.results?.length) hits.push(`${c}:${d.results.length}`);
      }
      return hits.length ? hits.join(" ") : "none resolved (POST-only?)";
    },
  },
  {
    name: "ATS: BambooHR",
    why: "same",
    run: async () => {
      const hits: string[] = [];
      for (const c of ["fastly", "asana"]) {
        const r = await get(`https://${c}.bamboohr.com/careers/list`);
        const d = j(r.text);
        if (d?.result?.length) hits.push(`${c}:${d.result.length}`);
      }
      return hits.length ? hits.join(" ") : "none resolved";
    },
  },
  {
    name: "API spec + llms.txt discovery",
    why: "NEW ENDPOINTS ship before the blog post",
    run: async () => {
      const hits: string[] = [];
      for (const d of ["stripe.com", "linear.app", "vercel.com", "notion.so"]) {
        for (const p of ["/llms.txt", "/openapi.json", "/.well-known/ai-plugin.json"]) {
          const r = await get(`https://${d}${p}`).catch(() => null);
          if (r && r.status === 200 && r.text.length > 50) { hits.push(`${d}${p}:${Math.round(r.text.length / 1024)}kb`); }
        }
      }
      return hits.length ? hits.join(" ") : "none found";
    },
  },
  {
    name: "Wikidata structured facts",
    why: "founded, HQ, parent, employee count, funding",
    run: async () => {
      const s = await get("https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Notion%20Labs&language=en&format=json");
      const id = j(s.text)?.search?.[0]?.id;
      if (!id) return "no entity found";
      const e = await get(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`);
      const claims = Object.keys(j(e.text)?.entities?.[id]?.claims ?? {});
      return `${id}, ${claims.length} properties`;
    },
  },
  {
    name: "Docker Hub pulls",
    why: "adoption for infra competitors",
    run: async () => {
      const r = await get("https://hub.docker.com/v2/repositories/library/postgres/");
      const d = j(r.text);
      return d ? `${(d.pull_count / 1e9).toFixed(1)}B pulls, ${d.star_count} stars` : `HTTP ${r.status}`;
    },
  },
  {
    name: "VS Code Marketplace",
    why: "installs + ratings for devtool competitors",
    run: async () => {
      const r = await fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json;api-version=7.2-preview.1", "user-agent": UA },
        body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: "GitHub.copilot" }] }], flags: 914 }),
        signal: AbortSignal.timeout(T),
      });
      const d = j(await r.text());
      const stats = d?.results?.[0]?.extensions?.[0]?.statistics ?? [];
      const get2 = (n: string) => stats.find((s: { statisticName: string }) => s.statisticName === n)?.value;
      return r.status === 200 ? `installs=${get2("install")?.toLocaleString()} rating=${get2("averagerating")?.toFixed(2)}` : `HTTP ${r.status}`;
    },
  },
  {
    name: "Podcastindex (mentions)",
    why: "podcast mentions - needs free key",
    run: async () => {
      const r = await get("https://api.podcastindex.org/api/1.0/search/byterm?q=notion");
      return `HTTP ${r.status} — free but requires key+HMAC auth`;
    },
  },
  {
    name: "Homebrew install analytics",
    why: "adoption for CLI/desktop competitors",
    run: async () => {
      const r = await get("https://formulae.brew.sh/api/analytics/install/30d.json");
      const d = j(r.text);
      return d?.items ? `${d.items.length} formulae ranked, 30d window` : `HTTP ${r.status}`;
    },
  },
];

async function main() {
  console.log(`\nDELTA extra-source probe — ${new Date().toISOString()}\n`);
  const bad: string[] = [];
  for (const p of probes) {
    const t0 = Date.now();
    let detail: string, ok = false;
    try {
      detail = await p.run();
      ok = !/^HTTP [45]|none resolved|none found|no entity|needs |not in HTML/.test(detail);
    } catch (e) { detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 70) : String(e); }
    console.log(`  ${ok ? "OK" : "!!"} ${p.name.padEnd(28)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`);
    console.log(`     ${"".padEnd(28)}        └ ${p.why}`);
    if (!ok) bad.push(p.name);
  }
  console.log(`\n${probes.length - bad.length}/${probes.length} usable. Not usable: ${bad.join(", ") || "none"}\n`);
}
main();

export {}; // module scope: keeps this script's top-level names out of the global TS program
