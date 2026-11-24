/**
 * The named-query registry — the ONLY way data leaves this system.
 *
 * Fixed, parameterised queries, never arbitrary SQL from a caller. Each one is
 * a black box with a name, a price in metered units, and a description, so the
 * REST route, the MCP server and the Skill all enumerate the same list without
 * any of them knowing how a query is implemented.
 *
 * `tier` encodes the one pricing decision that matters: **the present is free,
 * the past is paid.** A `public` query returns current state, which anyone can
 * already read off the company's own website and off our own public pages, so
 * charging for it would be charging for nothing. A `licensed` query reads the
 * change history, which cannot be regenerated without having watched.
 */

import { publicDomain } from "./domain";
import { adaptersFor } from "./sources/registry";
import { runCompany } from "./sources/run";
import type { Company, Fact } from "./sources/types";
import {
  companyChanges,
  companyFacts,
  crawlStats,
  storeConfigured,
  upsertCompany,
  registerSurfaces,
  vendorAdopters,
  watchCompany,
  watchlistChanges,
  type StoredChange,
  type StoredFact,
} from "./store";

export type QueryResult =
  | { ok: true; data: unknown; meta: { units: number; sources: string[] } }
  | { ok: false; error: string; status: number };

/** What the caller proved about themselves. */
export type QueryCtx = { licenseKey: string | null };

export type QueryDef = {
  name: string;
  describe: string;
  /** Metered units charged against the licence BEFORE the work runs. */
  units: number;
  /** `public` needs no licence. `licensed` reads history and does. */
  tier: "public" | "licensed";
  /** Parameter names, for the MCP tool schema and the Skill. */
  params: readonly { name: string; type: "string" | "number"; required: boolean; describe: string }[];
  run: (params: Record<string, unknown>, ctx: QueryCtx) => Promise<QueryResult>;
};

const DOMAIN_PARAM = {
  name: "domain",
  type: "string",
  required: true,
  describe: "Company domain, e.g. linear.app. Not a URL.",
} as const;

/**
 * Validate a caller-supplied domain — through the SAME guard the public page
 * uses, not a looser local copy.
 *
 * This used to accept anything containing a dot, so `169.254.169.254` passed
 * and the API would crawl the cloud metadata endpoint on request. The public
 * page was never vulnerable because it calls `publicDomain()`; the API and
 * the MCP server had their own weaker check, which is exactly how a guard
 * gets bypassed — by being reimplemented.
 */
const needDomain = (p: Record<string, unknown>): string | null =>
  typeof p.domain === "string" ? publicDomain(p.domain) : null;

const limitOf = (p: Record<string, unknown>, fallback = 50, cap = 500) => {
  const n = Number(p.limit);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), cap) : fallback;
};

const noStore = (name: string): QueryResult => ({
  ok: false,
  status: 503,
  error: `"${name}" needs the history store, which is not configured on this deployment.`,
});

/** Shape a stored fact for output: the quote and source are the point. */
const factOut = (f: StoredFact) => ({
  path: f.path,
  value: f.value,
  confidence: f.confidence,
  source: f.source_url,
  quote: f.quote,
  observedAt: f.updated_at,
});

const changeOut = (c: StoredChange) => ({
  at: c.at,
  domain: c.company_domain,
  path: c.path,
  from: c.old_value,
  to: c.new_value,
  source: c.source_url,
  quote: c.quote,
});

/** Still genuinely unbuilt. Says so rather than returning an empty list. */
const notBuilt = (name: string, units: number, describe: string): QueryDef => ({
  name,
  units,
  describe,
  tier: "licensed",
  params: [DOMAIN_PARAM],
  async run() {
    return {
      ok: false,
      status: 501,
      error: `"${name}" is not built yet. It is on the roadmap; it is not silently returning nothing.`,
    };
  },
});

export const QUERIES: readonly QueryDef[] = [
  {
    name: "company_dossier",
    describe:
      "Everything currently known about one company: pricing tiers, vendor stack, releases, " +
      "hiring, security posture and legal entity, each with its source URL and a quote.",
    units: 10,
    tier: "public",
    params: [DOMAIN_PARAM],
    async run(params) {
      const domain = needDomain(params);
      if (!domain) return { ok: false, status: 400, error: "A valid `domain` is required." };

      // Store first. A tracked company answers from the index in one round
      // trip; crawling 36 sources live to re-derive what we already have would
      // be slow for the caller and rude to the sources.
      if (storeConfigured()) {
        const stored = await companyFacts(domain);
        if (stored.ok && stored.data && stored.data.length > 0) {
          return {
            ok: true,
            data: {
              domain,
              tracked: true,
              facts: stored.data.map(factOut),
              count: stored.data.length,
            },
            meta: { units: this.units, sources: [...new Set(stored.data.map((f) => f.kind))] },
          };
        }
      }

      // Not tracked yet: crawl it live so a cold domain still answers.
      const company: Company = { domain, ...((params.handles as object) ?? {}) };
      const runs = await runCompany(company, adaptersFor(company));

      const facts: Fact[] = [];
      const sources: string[] = [];
      const failures: { source: string; reason: string }[] = [];
      for (const r of runs) {
        if (r.status === "ok") {
          facts.push(...r.facts);
          sources.push(r.kind);
        } else if (r.status === "fail") failures.push({ source: r.kind, reason: r.reason });
      }

      return {
        ok: true,
        data: {
          domain,
          tracked: false,
          facts,
          // Say what we could NOT see. A dossier with silent gaps is a lie by
          // omission, and coverage honesty is a feature of this product.
          unavailable: failures,
          checked: runs.length,
        },
        meta: { units: this.units, sources },
      };
    },
  },

  {
    name: "changes_feed",
    describe:
      "What changed about a company and when, newest first — the before and after value, with " +
      "the source. This is the history that cannot be looked up anywhere else.",
    units: 1,
    tier: "licensed",
    params: [
      DOMAIN_PARAM,
      { name: "limit", type: "number", required: false, describe: "Max changes to return (default 50)." },
    ],
    async run(params) {
      const domain = needDomain(params);
      if (!domain) return { ok: false, status: 400, error: "A valid `domain` is required." };
      if (!storeConfigured()) return noStore(this.name);

      const res = await companyChanges(domain, limitOf(params));
      if (!res.ok) return { ok: false, status: 502, error: res.error };

      const rows = res.data ?? [];
      return {
        ok: true,
        data: { domain, changes: rows.map(changeOut), count: rows.length },
        meta: { units: this.units, sources: [...new Set(rows.map((c) => c.kind))] },
      };
    },
  },

  {
    name: "price_history",
    describe:
      "Every recorded pricing change for a company — tier renames, price moves and features " +
      "crossing between tiers, with the date each was observed.",
    units: 2,
    tier: "licensed",
    params: [DOMAIN_PARAM],
    async run(params) {
      const domain = needDomain(params);
      if (!domain) return { ok: false, status: 400, error: "A valid `domain` is required." };
      if (!storeConfigured()) return noStore(this.name);

      const res = await companyChanges(domain, 500);
      if (!res.ok) return { ok: false, status: 502, error: res.error };

      // Filtered here rather than in SQL: `company_changes` is one indexed
      // function serving several queries, and 500 rows is nothing to scan.
      const rows = (res.data ?? []).filter((c) => c.path.startsWith("pricing."));
      return {
        ok: true,
        data: { domain, changes: rows.map(changeOut), count: rows.length },
        meta: { units: this.units, sources: ["pricing"] },
      };
    },
  },

  {
    name: "compare_companies",
    describe:
      "Two companies side by side on current state: pricing, stack, licence, posture. " +
      "Returns only the paths where they actually differ.",
    units: 5,
    tier: "public",
    params: [
      { name: "a", type: "string", required: true, describe: "First company domain." },
      { name: "b", type: "string", required: true, describe: "Second company domain." },
    ],
    async run(params) {
      const a = needDomain({ domain: params.a });
      const b = needDomain({ domain: params.b });
      if (!a || !b) return { ok: false, status: 400, error: "Both `a` and `b` must be valid domains." };
      if (a === b) return { ok: false, status: 400, error: "`a` and `b` must be different." };
      if (!storeConfigured()) return noStore(this.name);

      const [ra, rb] = await Promise.all([companyFacts(a), companyFacts(b)]);
      if (!ra.ok || !rb.ok) return { ok: false, status: 502, error: "Could not read both companies." };

      const mapOf = (rows: StoredFact[] | null) =>
        new Map((rows ?? []).map((f) => [f.path, f]));
      const ma = mapOf(ra.data);
      const mb = mapOf(rb.data);

      const rows = [...new Set([...ma.keys(), ...mb.keys()])]
        .sort()
        .map((path) => ({
          path,
          [a]: ma.get(path)?.value ?? null,
          [b]: mb.get(path)?.value ?? null,
        }))
        // Only differences. A table of 400 identical rows is not a comparison.
        .filter((r) => r[a] !== r[b]);

      return {
        ok: true,
        data: { a, b, differences: rows, count: rows.length, factsA: ma.size, factsB: mb.size },
        meta: { units: this.units, sources: ["index"] },
      };
    },
  },

  {
    name: "vendor_adopters",
    describe:
      "Which tracked companies use a given vendor, read from their public DNS verification " +
      "records — back-office purchases that frontend script detection cannot see.",
    units: 2,
    tier: "public",
    params: [
      { name: "vendor", type: "string", required: true, describe: "Vendor slug, e.g. anthropic, stripe, rippling." },
    ],
    async run(params) {
      const vendor = typeof params.vendor === "string" ? params.vendor.trim().toLowerCase() : "";
      if (!vendor) return { ok: false, status: 400, error: "A `vendor` is required." };
      if (!storeConfigured()) return noStore(this.name);

      const res = await vendorAdopters(vendor);
      if (!res.ok) return { ok: false, status: 502, error: res.error };

      const rows = res.data ?? [];
      return {
        ok: true,
        data: {
          vendor,
          adopters: rows.map((r) => ({ domain: r.company_domain, source: r.source_url, observedAt: r.updated_at })),
          count: rows.length,
          // A DNS verification record proves a relationship, not a paid seat
          // count. Saying so is the difference between data and a claim.
          caveat: "A verification record proves a relationship with the vendor, not the size or price of it.",
        },
        meta: { units: this.units, sources: ["stack.dns"] },
      };
    },
  },

  {
    name: "my_changes",
    describe: "Everything that changed across your whole watchlist since a date, newest first.",
    units: 1,
    tier: "licensed",
    params: [
      { name: "since", type: "string", required: false, describe: "ISO date. Defaults to 7 days ago." },
      { name: "limit", type: "number", required: false, describe: "Max changes (default 100)." },
    ],
    async run(params, ctx) {
      if (!ctx.licenseKey) return { ok: false, status: 402, error: "This query needs a licence key." };
      if (!storeConfigured()) return noStore(this.name);

      const raw = typeof params.since === "string" ? Date.parse(params.since) : NaN;
      const since = Number.isFinite(raw) ? new Date(raw) : new Date(Date.now() - 7 * 86_400_000);

      const res = await watchlistChanges(ctx.licenseKey, since, limitOf(params, 100));
      if (!res.ok) return { ok: false, status: 502, error: res.error };

      const rows = res.data ?? [];
      return {
        ok: true,
        data: { since: since.toISOString(), changes: rows.map(changeOut), count: rows.length },
        meta: { units: this.units, sources: [...new Set(rows.map((c) => c.kind))] },
      };
    },
  },

  {
    name: "track_company",
    describe:
      "Add a company to your watchlist. It is collected on the next 12-hour window and " +
      "back-filled from archives after that.",
    units: 1,
    tier: "licensed",
    params: [DOMAIN_PARAM],
    async run(params, ctx) {
      const domain = needDomain(params);
      if (!domain) return { ok: false, status: 400, error: "A valid `domain` is required." };
      if (!ctx.licenseKey) return { ok: false, status: 402, error: "This query needs a licence key." };
      if (!storeConfigured()) return noStore(this.name);

      // The company row is GLOBAL and deduped by domain, so adding one another
      // customer already tracks costs nothing and starts with their history.
      const up = await upsertCompany({ domain });
      if (!up.ok) return { ok: false, status: 502, error: up.error };

      const adapters = adaptersFor({ domain });
      await registerSurfaces(domain, adapters.map((a) => a.kind), adapters.map((a) => a.cadence));

      const watch = await watchCompany(ctx.licenseKey, domain);
      if (!watch.ok) return { ok: false, status: 502, error: watch.error };

      return {
        ok: true,
        data: {
          domain,
          watching: true,
          surfaces: adapters.length,
          nextWindow: "00:00 or 12:00 UTC, whichever comes first",
        },
        meta: { units: this.units, sources: [] },
      };
    },
  },

  {
    name: "coverage",
    describe: "How much we currently hold: companies, surfaces, facts and recorded changes.",
    units: 0,
    tier: "public",
    params: [],
    async run() {
      if (!storeConfigured()) return noStore(this.name);
      const res = await crawlStats();
      if (!res.ok) return { ok: false, status: 502, error: res.error };
      return {
        ok: true,
        data: { ...(res.data?.[0] ?? {}), refresh: "00:00 and 12:00 UTC" },
        meta: { units: 0, sources: ["index"] },
      };
    },
  },

  notBuilt("media_perception", 2, "News volume and tone over time."),
  notBuilt("mentions_feed", 2, "Where a company was mentioned, across sources."),
  notBuilt("unannounced_signals", 2, "New subdomains, URLs and API endpoints before announcement."),
  notBuilt("category_trends", 5, "Cross-company trends within a category."),
] as const;

export const byName = (n: string): QueryDef | undefined => QUERIES.find((q) => q.name === n);

/** The catalogue, for the API index, the MCP tool list and the Skill. */
export const catalogue = () =>
  QUERIES.map((q) => ({
    name: q.name,
    describe: q.describe,
    units: q.units,
    tier: q.tier,
    params: q.params,
  }));
