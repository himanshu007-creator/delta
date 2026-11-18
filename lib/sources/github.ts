/**
 * The GitHub bundle.
 *
 * GitHub is the deepest free source in the catalog and we were using almost
 * none of it. Everything here was verified live, unauthenticated, in Phase 0c
 * (see PHASE0.md) — on vercel/next.js, cli/cli and orgs/vercel.
 *
 * These are NINE separate adapters rather than one "bundle" call, on purpose:
 *   - each endpoint gets its own content hash, so an unchanged endpoint takes
 *     the free fast path independently instead of being re-parsed because some
 *     sibling moved;
 *   - each gets its own cadence (SBOM is 11k packages and runs weekly; releases
 *     run every 12h);
 *   - one endpoint failing or going 202 cannot cost the others.
 *
 * AUTH: unauthenticated is 60 requests/hour, which nine adapters per company
 * exhausts almost immediately, and star timestamps 401 outright. GITHUB_TOKEN
 * lifts it to 5,000/hour. Every adapter here sends it when present.
 *
 * The highest-value signal is the least obvious one: **licence**. A relicence
 * IS a business-model change — HashiCorp to BSL, Redis to RSAL, Elastic and
 * MongoDB to SSPL all made headlines and moved customers. `archived` is the
 * other: it means the product is dead.
 */

import { asArr, asObj, asObjArr, num, quote, sum, type Adapter, type Company, type Fact } from "./types";

const GH = "https://api.github.com";

/** Read the token at call time; it may be added after the process starts. */
const ghHeaders = (): Record<string, string> => {
  const t = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(t ? { authorization: `Bearer ${t}` } : {}),
  };
};

const repo = (c: Company) => c.github ?? null;
const org = (c: Company) => c.githubOrg ?? c.github?.split("/")[0] ?? null;

/**
 * GitHub's /stats/* endpoints answer 202 with an empty body while they compute
 * the series, then serve it on a later call. That is NOT an error and must not
 * be recorded as one — it just means "ask again next window".
 */
const stillComputing = (body: unknown) =>
  body === null || body === undefined ||
  (Array.isArray(body) && body.length === 0) ||
  (typeof body === "object" && !Array.isArray(body) && Object.keys(body as object).length === 0);

export const GITHUB_ADAPTERS: readonly Adapter[] = [
  // ---- core repo facts ---------------------------------------------------
  {
    kind: "github.repo",
    module: "3. Product & releases",
    label: "GitHub repository",
    cadence: "12h", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}` : null),
    headers: ghHeaders,
    rate: { minIntervalMs: 800 },
    extract: (b, { url }) => {
      const r = asObj<{
        stargazers_count?: number; forks_count?: number; open_issues_count?: number;
        subscribers_count?: number; size?: number; archived?: boolean; disabled?: boolean;
        license?: { spdx_id?: string; name?: string } | null;
        topics?: string[]; pushed_at?: string; created_at?: string;
        description?: string; default_branch?: string;
      }>(b);
      const f: Fact[] = [
        { path: "product.github.stars", value: r.stargazers_count ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.forks", value: r.forks_count ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.open_issues", value: r.open_issues_count ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.watchers", value: r.subscribers_count ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.size_kb", value: r.size ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.pushed_at", value: r.pushed_at ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.created_at", value: r.created_at ?? null, sourceUrl: url, confidence: 1 },
      ];
      // THE SIGNAL. A licence change is a business-model change.
      if (r.license?.spdx_id) {
        f.push({
          path: "product.github.license", value: r.license.spdx_id, sourceUrl: url, confidence: 1,
          quote: quote(r.license.name ?? r.license.spdx_id, 80),
        });
        // VERIFIED: `spdx_id` is NOASSERTION for every source-available licence
        // — Terraform, Redis, Elasticsearch and MongoDB all report
        // spdx="NOASSERTION", key="other", name="Other". So restrictiveness
        // CANNOT be judged here; the github.license adapter reads the LICENSE
        // text instead. Flag the ambiguity rather than guessing.
        f.push({
          path: "product.github.license_unresolved",
          value: r.license.spdx_id === "NOASSERTION",
          sourceUrl: url, confidence: 1,
        });
      }
      // Sunset.
      if (r.archived !== undefined) f.push({ path: "product.github.archived", value: r.archived, sourceUrl: url, confidence: 1 });
      if (r.topics?.length) {
        f.push({ path: "product.github.topics", value: r.topics.slice(0, 30).join(","), sourceUrl: url, confidence: 1 });
      }
      if (r.description) {
        // Positioning, in the maintainers' own words.
        f.push({ path: "product.github.description", value: quote(r.description, 200), sourceUrl: url, confidence: 1, quote: quote(r.description, 200) });
      }
      return f;
    },
  },

  // ---- the licence, read properly ---------------------------------------
  {
    /**
     * A relicence IS a business-model change, and it is the single most
     * newsworthy thing a commercial open-source company does. GitHub's
     * `spdx_id` cannot see it (every such project reports NOASSERTION), so this
     * adapter reads the LICENSE text and classifies it.
     */
    kind: "github.license",
    module: "15. Reliability & security posture",
    label: "LICENSE file",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}/license` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      const r = asObj<{ content?: string; encoding?: string; license?: { spdx_id?: string } }>(b);
      if (!r.content) return [];
      let text = "";
      try {
        text = r.encoding === "base64" ? Buffer.from(r.content, "base64").toString("utf8") : r.content;
      } catch { return []; }
      const head = text.slice(0, 4000);

      // Ordered most-specific first. Each pattern is taken from the actual
      // LICENSE text of a project that made this exact move.
      const SOURCE_AVAILABLE: ReadonlyArray<[RegExp, string]> = [
        [/Business Source License/i, "BUSL-1.1"],
        [/Server Side Public License/i, "SSPL-1.0"],
        [/Elastic License/i, "Elastic-2.0"],
        [/Redis Source Available License|Redis Software License/i, "RSAL"],
        [/Functional Source License/i, "FSL"],
        [/Commons Clause/i, "Commons-Clause"],
        [/Confluent Community License/i, "Confluent-Community"],
        [/Fair Source License/i, "Fair-Source"],
        [/PolyForm/i, "PolyForm"],
      ];
      const hit = SOURCE_AVAILABLE.find(([re]) => re.test(head));

      // Well-known permissive/copyleft licences, so "unknown" stays rare. These
      // are NOT restrictive; they are here only to make the fact useful when
      // GitHub itself could not resolve an SPDX id (torvalds/linux ships
      // COPYING rather than LICENSE, for instance).
      const KNOWN: ReadonlyArray<[RegExp, string]> = [
        [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL-3.0"],
        [/GNU LESSER GENERAL PUBLIC LICENSE/i, "LGPL"],
        [/GNU GENERAL PUBLIC LICENSE/i, "GPL"],
        [/Mozilla Public License/i, "MPL-2.0"],
        [/Apache License/i, "Apache-2.0"],
        [/The MIT License|Permission is hereby granted, free of charge/i, "MIT"],
        [/BSD 3-Clause|Redistributions of source code must retain/i, "BSD"],
        [/ISC License/i, "ISC"],
        [/Creative Commons/i, "CC"],
      ];

      const spdx = r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null;
      const known = hit ? null : KNOWN.find(([re]) => re.test(head));
      const detected = hit ? hit[1] : spdx ?? known?.[1] ?? "unknown";

      const f: Fact[] = [
        {
          path: "product.github.license_detected", value: detected, sourceUrl: url,
          confidence: hit || spdx ? 1 : known ? 0.8 : 0.4,
          quote: quote(head.replace(/\s+/g, " "), 200),
        },
        {
          // The flag that actually means something: the open-source promise was
          // withdrawn, which is what moves customers and makes news.
          path: "product.github.license_restrictive", value: Boolean(hit), sourceUrl: url, confidence: hit ? 1 : 0.8,
        },
      ];
      // Tri/dual licensing is its own signal — it usually precedes or
      // accompanies a move away from a permissive licence.
      if (/\b(tri-licens|triple licens|dual[- ]licens)\w*/i.test(head)) {
        f.push({ path: "product.github.license_multi", value: true, sourceUrl: url, confidence: 0.9, quote: quote(head.replace(/\s+/g, " "), 200) });
      }
      return f;
    },
  },

  // ---- tech stack --------------------------------------------------------
  {
    kind: "github.languages",
    module: "7. Vendor & tech stack",
    label: "GitHub language breakdown",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}/languages` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      const langs = asObj<Record<string, number>>(b) as Record<string, number>;
      const total = sum(Object.values(langs));
      if (!total) return [];
      const ranked = Object.entries(langs).sort((a, b2) => b2[1] - a[1]);
      return [
        { path: "stack.languages", value: ranked.map(([k]) => k).slice(0, 12).join(","), sourceUrl: url, confidence: 1 },
        // A new language appearing is a story — Rust showing up in a JS codebase
        // means a rewrite or a performance push.
        ...ranked.slice(0, 8).map(([k, v]): Fact => ({
          path: `stack.language.${k.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_pct`,
          value: Math.round((v / total) * 1000) / 10,
          sourceUrl: url, confidence: 1,
        })),
      ];
    },
  },

  // ---- engineering velocity ---------------------------------------------
  {
    kind: "github.activity",
    module: "3. Product & releases",
    label: "GitHub commit activity (52 weeks)",
    cadence: "12h", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}/stats/commit_activity` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      // 202 while GitHub computes the series. Not a failure; ask again later.
      //
      // CAVEAT, observed: for very large repos (vercel/next.js) this never
      // resolved across repeated attempts — GitHub appears to give up computing
      // the series. The adapter degrades to no-facts rather than failing, and
      // ecosyste.ms mirrors commit stats as the reliable alternative.
      if (stillComputing(b)) return [];
      const weeks = asObjArr<{ total?: number }>(b).map((w) => num(w.total) ?? 0);
      if (weeks.length < 8) return [];
      const last4 = weeks.slice(-4);
      const recent = sum(weeks.slice(-13));
      const prior = sum(weeks.slice(-26, -13));
      const f: Fact[] = [
        { path: "product.github.commits_52w", value: sum(weeks), sourceUrl: url, confidence: 1 },
        { path: "product.github.commits_last_4w", value: sum(last4), sourceUrl: url, confidence: 1 },
      ];
      // Is engineering accelerating or dying? Only visible as a ratio.
      if (prior > 0) {
        f.push({
          path: "product.github.velocity_trend_pct",
          value: Math.round(((recent - prior) / prior) * 100),
          sourceUrl: url, confidence: 0.9,
        });
      }
      return f;
    },
  },

  // ---- releases, with real download numbers ------------------------------
  {
    kind: "github.releases",
    module: "3. Product & releases",
    label: "GitHub releases",
    cadence: "12h", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}/releases?per_page=10` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      const rels = asObjArr<{
        tag_name?: string; name?: string; published_at?: string; prerelease?: boolean;
        body?: string; assets?: { download_count?: number }[];
      }>(b);
      const stable = rels.filter((r) => !r.prerelease);
      const latest = stable[0] ?? rels[0];
      if (!latest) return [];
      const f: Fact[] = [
        { path: "product.github.latest_tag", value: latest.tag_name ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.latest_release_at", value: latest.published_at ?? null, sourceUrl: url, confidence: 1 },
        { path: "product.github.releases_tracked", value: rels.length, sourceUrl: url, confidence: 1 },
      ];
      // Asset downloads are REAL adoption, unlike stars.
      const downloads = sum(rels.flatMap((r) => (r.assets ?? []).map((a) => a.download_count ?? 0)));
      if (downloads > 0) {
        f.push({ path: "product.github.release_downloads", value: downloads, sourceUrl: url, confidence: 1 });
      }
      // Release cadence: median days between the last few stable releases.
      const dates = stable.map((r) => r.published_at).filter(Boolean).map((d) => new Date(d!).getTime()).sort((a, b2) => b2 - a);
      if (dates.length >= 3) {
        const gaps = dates.slice(1).map((t, i) => Math.round((dates[i] - t) / 86_400_000));
        const median = [...gaps].sort((a, b2) => a - b2)[Math.floor(gaps.length / 2)];
        f.push({ path: "product.github.release_cadence_days", value: median, sourceUrl: url, confidence: 0.8 });
      }
      if (latest.body) {
        f.push({ path: "product.github.latest_release_notes", value: quote(latest.body, 400), sourceUrl: url, confidence: 1, quote: quote(latest.body, 400) });
      }
      return f;
    },
  },

  // ---- who actually writes the code -------------------------------------
  {
    kind: "github.contributors",
    module: "5. Hiring & org",
    label: "GitHub contributors",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}/contributors?per_page=100&anon=1` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      const cs = asObjArr<{ login?: string; contributions?: number }>(b);
      if (!cs.length) return [];
      const total = sum(cs.map((c) => c.contributions ?? 0));
      const top = cs[0];
      const f: Fact[] = [
        { path: "org.github.contributors", value: cs.length, sourceUrl: url, confidence: 0.9 },
        { path: "org.github.top_contributor", value: top.login ?? null, sourceUrl: url, confidence: 1 },
        { path: "org.github.top_contributor_commits", value: top.contributions ?? null, sourceUrl: url, confidence: 1 },
      ];
      // Key-person risk: one author owning most of the commits is fragile.
      if (total > 0 && top.contributions) {
        f.push({
          path: "org.github.top_contributor_share_pct",
          value: Math.round((top.contributions / total) * 100),
          sourceUrl: url, confidence: 0.9,
        });
      }
      return f;
    },
  },

  // ---- their code dependency tree ---------------------------------------
  {
    // The code-level twin of the DNS TXT vendor signal: DNS shows what they
    // BUY, the SBOM shows what they BUILD ON.
    kind: "github.sbom",
    module: "7. Vendor & tech stack",
    label: "GitHub dependency graph (SBOM)",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (repo(c) ? `${GH}/repos/${repo(c)}/dependency-graph/sbom` : null),
    headers: ghHeaders,
    maxBytes: 20_000_000, // observed 11,586 packages
    timeoutMs: 30_000,
    extract: (b, { url }) => {
      const pkgs = asObjArr<{ name?: string }>(asObj<{ sbom?: { packages?: unknown } }>(b).sbom?.packages);
      if (!pkgs.length) return [];
      const names = pkgs.map((p) => p.name ?? "").filter(Boolean);
      return [
        { path: "stack.dependencies.count", value: names.length, sourceUrl: url, confidence: 1 },
        // Ecosystem mix, from the package-name prefixes GitHub emits.
        { path: "stack.dependencies.ecosystems", value: [...new Set(names.map((n) => n.split(":")[0]).filter((x) => x && x.length < 16))].sort().join(","), sourceUrl: url, confidence: 0.8 },
      ];
    },
  },

  // ---- org shape ---------------------------------------------------------
  {
    kind: "github.org",
    module: "5. Hiring & org",
    label: "GitHub org public members",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (org(c) ? `${GH}/orgs/${org(c)}/public_members?per_page=100` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      const m = asArr<unknown>(b);
      return [{
        // A floor, not a headcount: only members who made membership public.
        path: "org.github.public_members", value: m.length, sourceUrl: url, confidence: 0.6,
      }];
    },
  },

  // ---- live activity ----------------------------------------------------
  {
    kind: "github.events",
    module: "3. Product & releases",
    label: "GitHub org activity feed",
    cadence: "12h", tier: "B", format: "json",
    url: (c) => (org(c) ? `${GH}/orgs/${org(c)}/events?per_page=100` : null),
    headers: ghHeaders,
    extract: (b, { url }) => {
      const evs = asObjArr<{ type?: string }>(b);
      if (!evs.length) return [];
      const counts = new Map<string, number>();
      for (const e of evs) {
        const t = (e.type ?? "").replace(/Event$/, "");
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      return [
        { path: "product.github.events_sampled", value: evs.length, sourceUrl: url, confidence: 1 },
        ...[...counts.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 12).map(([t, n]): Fact => ({
          path: `product.github.event.${t.toLowerCase()}`, value: n, sourceUrl: url, confidence: 1,
        })),
      ];
    },
  },

  // ---- issue hygiene ----------------------------------------------------
  {
    // NOTE: the search API has its OWN, much lower rate limit (30/min
    // authenticated, 10/min without), hence daily and a long interval.
    kind: "github.issues",
    module: "8. Support & customer pain",
    label: "GitHub closed-issue volume",
    cadence: "daily", tier: "B", format: "json",
    url: (c) => (repo(c) ? `${GH}/search/issues?q=repo:${repo(c)}+is:issue+is:closed&per_page=1` : null),
    headers: ghHeaders,
    rate: { minIntervalMs: 3000 },
    extract: (b, { url }) => {
      const n = num(asObj<{ total_count?: number }>(b).total_count);
      return n === null ? [] : [{ path: "support.github.issues_closed", value: n, sourceUrl: url, confidence: 1 }];
    },
  },
] as const;
