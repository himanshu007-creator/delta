/**
 * Repo health, security posture and reliability — three third-party
 * aggregators that each give something the primary sources cannot.
 *
 * All verified live (see PHASE0.md), all keyless:
 *
 *  - ecosyste.ms /repos  — commit totals and a bus-factor score, which GitHub's
 *    own /stats endpoints 202 on forever for large repos. Also the only place we
 *    see repo RENAMES, which mark a rebrand or pivot.
 *  - OpenSSF Scorecard   — a 0-10 security posture score with 14 named checks,
 *    directly comparable between competitors. Nobody sells this at our price.
 *  - Statuspage          — incident history, from which MTTR falls out. "Their
 *    mean time to resolve is 4h, ours is 40m" is a sales weapon, for free.
 *
 * Two traps are handled explicitly, both found by probing rather than reading:
 *
 *  1. Scorecard uses score = -1 for "internal error" / "not applicable", NOT
 *     zero. Branch-Protection and Signed-Releases both returned -1 on a healthy
 *     repo. Averaging those in, or reporting them as failures, would defame a
 *     project over our own parsing bug.
 *  2. ecosyste.ms serves SYNCED data, not live: `stargazers_count` was 143,489
 *     against GitHub's live 143,747, six days stale. So its freshness is
 *     recorded as a fact, and live counts stay with the GitHub adapters.
 *
 * NOTE: ecosyste.ms' /packages API returned 402 Payment Required when last
 * checked, having worked hours earlier. No adapter depends on it.
 */

import { asArr, asObj, asObjArr, num, quote, type Adapter, type Company, type Fact } from "./types";

const repo = (c: Company) => c.github ?? null;

/** Scorecard's sentinel for "could not evaluate". Never a real score. */
const NOT_EVALUATED = -1;

export const HEALTH_ADAPTERS: readonly Adapter[] = [
  // ---- ecosyste.ms: the stats GitHub will not compute --------------------
  {
    kind: "repo.ecosystems",
    module: "3. Product & releases",
    label: "ecosyste.ms repository data",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (repo(c) ? `https://repos.ecosyste.ms/api/v1/hosts/GitHub/repositories/${encodeURIComponent(repo(c)!)}` : null),
    rate: { minIntervalMs: 1200 },
    timeoutMs: 25_000,
    extract: (b, { url }) => {
      const r = asObj<{
        commit_stats?: { total_commits?: number; total_committers?: number; mean_commits?: number; dds?: number };
        metadata?: { files?: Record<string, string | null> };
        previous_names?: unknown; topics?: unknown; tags_count?: number;
        license?: string; archived?: boolean; fork?: boolean; language?: string;
        last_synced_at?: string; open_issues_count?: number; funding_links?: unknown;
      }>(b);

      const f: Fact[] = [];

      // DATA FRESHNESS as a first-class fact. This source is synced, not live,
      // and a stale number presented as current is a quiet lie.
      if (r.last_synced_at) {
        f.push({ path: "repo.ecosystems.synced_at", value: r.last_synced_at, sourceUrl: url, confidence: 1 });
      }

      const cs = asObj<{ total_commits?: number; total_committers?: number; mean_commits?: number; dds?: number }>(r.commit_stats);
      const commits = num(cs.total_commits);
      const committers = num(cs.total_committers);
      if (commits !== null) f.push({ path: "repo.commits_total", value: commits, sourceUrl: url, confidence: 0.9 });
      if (committers !== null) f.push({ path: "repo.committers_total", value: committers, sourceUrl: url, confidence: 0.9 });

      // Development Distribution Score: 1 = evenly spread, near 0 = one person
      // writes everything. A genuine bus-factor read, and the thing GitHub's
      // own stats endpoint refuses to compute for big repos.
      const dds = num(cs.dds);
      if (dds !== null) {
        f.push({ path: "repo.bus_factor_dds", value: Math.round(dds * 1000) / 1000, sourceUrl: url, confidence: 0.9 });
        f.push({ path: "repo.key_person_risk", value: dds < 0.5, sourceUrl: url, confidence: 0.8 });
      }

      // A RENAME is a rebrand or a pivot, and this is the only source that shows it.
      const prev = asArr<unknown>(r.previous_names).filter((x) => typeof x === "string") as string[];
      if (prev.length) {
        f.push({
          path: "repo.previous_names", value: prev.slice(0, 10).join(","), sourceUrl: url, confidence: 1,
          quote: quote(`renamed from ${prev.join(", ")}`, 120),
        });
      }

      // Which governance files exist — a crude but real maturity signal.
      const files = asObj<Record<string, string | null>>(r.metadata?.files);
      const present = Object.entries(files).filter(([, v]) => v).map(([k]) => k);
      if (present.length) {
        f.push({ path: "repo.governance_files", value: present.sort().join(","), sourceUrl: url, confidence: 0.9 });
      }

      if (r.archived !== undefined) f.push({ path: "repo.archived", value: r.archived, sourceUrl: url, confidence: 0.9 });
      if (num(r.tags_count) !== null) f.push({ path: "repo.tags_count", value: num(r.tags_count), sourceUrl: url, confidence: 0.9 });
      if (asArr<unknown>(r.funding_links).length) {
        f.push({ path: "repo.funding_links", value: asArr<unknown>(r.funding_links).length, sourceUrl: url, confidence: 0.9 });
      }
      return f;
    },
  },

  // ---- OpenSSF Scorecard: comparable security posture -------------------
  {
    kind: "security.scorecard",
    module: "15. Reliability & security posture",
    label: "OpenSSF Scorecard",
    cadence: "weekly", tier: "A", format: "json",
    url: (c) => (repo(c) ? `https://api.securityscorecards.dev/projects/github.com/${repo(c)}` : null),
    rate: { minIntervalMs: 1200 },
    extract: (b, { url }) => {
      const r = asObj<{ score?: number; date?: string; checks?: unknown }>(b);
      const overall = num(r.score);
      if (overall === null) return [];

      const f: Fact[] = [
        { path: "security.scorecard.score", value: overall, sourceUrl: url, confidence: 1 },
        // The date matters: a stale scan is weak evidence about today.
        ...(r.date ? [{ path: "security.scorecard.date", value: r.date, sourceUrl: url, confidence: 1 }] : []),
      ];

      const checks = asObjArr<{ name?: string; score?: number; reason?: string }>(r.checks);
      let evaluated = 0;
      const failing: string[] = [];

      for (const c of checks) {
        const name = typeof c.name === "string" ? c.name : "";
        const score = num(c.score);
        if (!name || score === null) continue;

        // -1 is "we could not evaluate this", NOT a zero. Reporting it as a
        // failure would accuse a project of something our parser invented.
        if (score === NOT_EVALUATED) {
          f.push({
            path: `security.scorecard.check.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            value: null, sourceUrl: url, confidence: 1,
            quote: quote(`not evaluated: ${c.reason ?? "no reason given"}`, 120),
          });
          continue;
        }

        evaluated++;
        if (score <= 3) failing.push(name);
        f.push({
          path: `security.scorecard.check.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          value: score, sourceUrl: url, confidence: 1,
          ...(c.reason ? { quote: quote(c.reason, 140) } : {}),
        });
      }

      f.push({ path: "security.scorecard.checks_evaluated", value: evaluated, sourceUrl: url, confidence: 1 });
      if (failing.length) {
        // The comparable headline: which specific controls they are weak on.
        f.push({ path: "security.scorecard.weak_checks", value: failing.sort().join(","), sourceUrl: url, confidence: 1 });
      }
      return f;
    },
  },

  // ---- Statuspage: reliability history, and MTTR ------------------------
  {
    /**
     * `statusHost` must be SET, never guessed: Phase 0 showed the
     * /api/v2/*.json convention is reliable but the host is not —
     * status.stripe.com 404s and notionstatus.com does not resolve. Host
     * discovery (footer link / sitemap / <name>.statuspage.io) is its own task.
     */
    kind: "reliability.incidents",
    module: "15. Reliability & security posture",
    label: "Status page incident history",
    cadence: "12h", tier: "A", format: "json",
    url: (c) => (c.statusHost ? `https://${c.statusHost}/api/v2/incidents.json` : null),
    rate: { minIntervalMs: 1500 },
    extract: (b, { url }) => {
      const incidents = asObjArr<{
        created_at?: string; resolved_at?: string | null; impact?: string;
        status?: string; name?: string;
      }>(asObj<{ incidents?: unknown }>(b).incidents);
      if (!incidents.length) return [];

      const now = Date.now();
      const dayMs = 86_400_000;
      const parsed = incidents.map((i) => ({
        created: i.created_at ? Date.parse(i.created_at) : NaN,
        resolved: i.resolved_at ? Date.parse(i.resolved_at) : null,
        impact: (i.impact ?? "none").toLowerCase(),
        status: (i.status ?? "").toLowerCase(),
        name: i.name ?? "",
      })).filter((i) => Number.isFinite(i.created));

      const since = (days: number) => parsed.filter((i) => now - i.created <= days * dayMs);
      const f: Fact[] = [
        { path: "reliability.incidents.sampled", value: parsed.length, sourceUrl: url, confidence: 1 },
        { path: "reliability.incidents.30d", value: since(30).length, sourceUrl: url, confidence: 1 },
        { path: "reliability.incidents.90d", value: since(90).length, sourceUrl: url, confidence: 1 },
      ];

      // Currently broken, right now.
      const open = parsed.filter((i) => i.status && i.status !== "resolved" && i.status !== "postmortem");
      f.push({ path: "reliability.incidents.open", value: open.length, sourceUrl: url, confidence: 1 });
      if (open.length) {
        f.push({ path: "reliability.incidents.open_titles", value: open.slice(0, 5).map((i) => i.name).join(" | ").slice(0, 400), sourceUrl: url, confidence: 1 });
      }

      // MTTR, over the resolved incidents only. The headline comparison.
      const durations = parsed
        .filter((i) => i.resolved !== null && i.resolved! > i.created)
        .map((i) => (i.resolved! - i.created) / 60_000);
      if (durations.length >= 3) {
        const sorted = [...durations].sort((a, b2) => a - b2);
        f.push({ path: "reliability.mttr_median_min", value: Math.round(sorted[Math.floor(sorted.length / 2)]), sourceUrl: url, confidence: 0.9 });
        f.push({ path: "reliability.mttr_mean_min", value: Math.round(durations.reduce((a, b2) => a + b2, 0) / durations.length), sourceUrl: url, confidence: 0.9 });
      }

      // Severity mix: ten minor blips are not one critical outage.
      for (const level of ["critical", "major", "minor"]) {
        const n = since(90).filter((i) => i.impact === level).length;
        if (n) f.push({ path: `reliability.incidents.90d.${level}`, value: n, sourceUrl: url, confidence: 1 });
      }

      const latest = parsed.reduce((a, b2) => (b2.created > a.created ? b2 : a));
      f.push({
        path: "reliability.last_incident_at", value: new Date(latest.created).toISOString(), sourceUrl: url, confidence: 1,
        quote: quote(latest.name, 140),
      });
      return f;
    },
  },

  // ---- Statuspage: current state ---------------------------------------
  {
    kind: "reliability.status",
    module: "15. Reliability & security posture",
    label: "Status page current status",
    cadence: "12h", tier: "A", format: "json",
    url: (c) => (c.statusHost ? `https://${c.statusHost}/api/v2/status.json` : null),
    rate: { minIntervalMs: 1500 },
    extract: (b, { url }) => {
      const s = asObj<{ status?: { indicator?: string; description?: string } }>(b).status;
      const st = asObj<{ indicator?: string; description?: string }>(s);
      if (!st.indicator) return [];
      return [
        { path: "reliability.status.indicator", value: st.indicator, sourceUrl: url, confidence: 1 },
        ...(st.description ? [{ path: "reliability.status.description", value: quote(st.description, 120), sourceUrl: url, confidence: 1, quote: quote(st.description, 120) }] : []),
      ];
    },
  },
] as const;
