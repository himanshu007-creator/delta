/**
 * The named-query registry — the ONLY way data leaves this system.
 *
 * Fixed, parameterised queries, never arbitrary SQL from a caller. Each one is
 * a black box with a name, a price in metered units, and a description, so the
 * REST route, the MCP server and the Skill all enumerate the same list without
 * any of them knowing how a query is implemented.
 *
 * `company_dossier` runs live off the source adapters, which means the whole
 * chain — licence → fetch → extract → facts — is exercised end to end before
 * any database exists. The history-backed queries report `not-configured`
 * until the stores are wired, rather than pretending to have data.
 */

import { adaptersFor } from "./sources/registry";
import { runCompany } from "./sources/run";
import type { Company, Fact } from "./sources/types";

export type QueryResult =
  | { ok: true; data: unknown; meta: { units: number; sources: string[] } }
  | { ok: false; error: string; status: number };

export type QueryDef = {
  name: string;
  describe: string;
  /** Metered units charged against the licence BEFORE the work runs. */
  units: number;
  run: (params: Record<string, unknown>) => Promise<QueryResult>;
};

const needDomain = (p: Record<string, unknown>): string | null => {
  const d = typeof p.domain === "string" ? p.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";
  return d && d.includes(".") && !/\s/.test(d) ? d : null;
};

/** Queries that need the time-series store, which is not wired yet. */
const notConfigured = (name: string, units: number, describe: string): QueryDef => ({
  name, units, describe,
  async run() {
    return {
      ok: false, status: 501,
      error: `"${name}" needs the history store, which is not configured on this deployment yet.`,
    };
  },
});

export const QUERIES: readonly QueryDef[] = [
  {
    name: "company_dossier",
    describe: "Everything we currently know about one company, from every applicable source.",
    units: 10,
    async run(params) {
      const domain = needDomain(params);
      if (!domain) return { ok: false, status: 400, error: "A valid `domain` is required." };

      const company: Company = { domain, ...(params.handles as object ?? {}) };
      const adapters = adaptersFor(company);
      const runs = await runCompany(company, adapters);

      const facts: Fact[] = [];
      const sources: string[] = [];
      const failures: { source: string; reason: string }[] = [];
      for (const r of runs) {
        if (r.status === "ok") { facts.push(...r.facts); sources.push(r.kind); }
        else if (r.status === "fail") failures.push({ source: r.kind, reason: r.reason });
      }

      return {
        ok: true,
        data: {
          domain,
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
  notConfigured("changes_feed", 1, "What changed about a company, newest first."),
  notConfigured("price_history", 2, "Every pricing change we have on record, back-filled from archives."),
  notConfigured("media_perception", 2, "News volume and tone over time."),
  notConfigured("mentions_feed", 2, "Where a company was mentioned, across sources."),
  notConfigured("unannounced_signals", 2, "New subdomains, URLs and API endpoints before announcement."),
  notConfigured("category_trends", 5, "Cross-company trends within a category."),
  notConfigured("compare_companies", 5, "Head-to-head across every module."),
  notConfigured("track_company", 1, "Add a company to the global crawl set."),
] as const;

export const byName = (n: string): QueryDef | undefined => QUERIES.find((q) => q.name === n);

/** The catalogue, for the API index, the MCP tool list and the Skill. */
export const catalogue = () => QUERIES.map((q) => ({ name: q.name, describe: q.describe, units: q.units }));
