/**
 * The crawl store.
 *
 * Talks PostgREST directly, like lib/usage-store.ts, so there is no Supabase
 * SDK dependency and the same service-role credential serves both. Every write
 * goes through a SECURITY DEFINER function — the app never sends SQL, and the
 * diff-and-append is one atomic statement rather than a read-then-write that
 * two concurrent crawl windows would race.
 *
 * Nothing here throws into a crawl window. A store failure degrades that one
 * surface, never the window, because a 12h window that dies halfway leaves the
 * dataset in a worse state than one that reports partial failure.
 */

import type { Fact } from "./sources/types";

const url = () => (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
// SERVICE ROLE, server-only. It bypasses row-level security by design, so it
// must never reach the browser.
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const storeConfigured = () => Boolean(url() && key());

/**
 * Production must FAIL CLOSED. Without this a misconfigured deploy would crawl
 * happily, write nowhere, and look healthy — losing history that cannot be
 * recovered, because a 12h window only happens once.
 */
export function assertStore(): void {
  if (!storeConfigured() && process.env.NODE_ENV === "production") {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production");
  }
}

type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  if (!storeConfigured()) return { ok: false, error: "store not configured" };
  try {
    const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: key(),
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
        // Set-returning functions stream rows; we want them all.
        Accept: "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${fn} ${res.status}: ${text.slice(0, 180)}` };
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    return { ok: false, error: `${fn}: ${(e as Error).message.slice(0, 140)}` };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type Handles = Record<string, unknown>;

export const upsertCompany = (c: {
  domain: string; name?: string | null; category?: string | null;
  handles?: Handles; requestedBy?: string | null;
}) =>
  rpc<null>("upsert_company", {
    p_domain: c.domain,
    p_name: c.name ?? null,
    p_category: c.category ?? null,
    p_handles: c.handles ?? {},
    p_requested_by: c.requestedBy ?? null,
  });

export const registerSurfaces = (domain: string, kinds: string[], cadences: string[]) =>
  rpc<number>("register_surfaces", { p_domain: domain, p_kinds: kinds, p_cadences: cadences });

export type ClaimedSurface = {
  company_domain: string;
  kind: string;
  last_hash: string | null;
  handles: Handles | null;
  name: string | null;
};

/** Atomically claim work for this window. SKIP LOCKED is enforced in SQL. */
export const claimSurfaces = (windowAt: Date, limit: number) =>
  rpc<ClaimedSurface[]>("claim_surfaces", { p_window_at: windowAt.toISOString(), p_limit: limit });

/**
 * Record a surface read. Facts are flattened to the shape the SQL expects;
 * `value` is stringified because one column holds every type, and the only
 * consumer that cares re-parses it.
 */
export const recordSurface = (domain: string, kind: string, hash: string | null, facts: readonly Fact[]) =>
  rpc<number>("record_surface", {
    p_domain: domain,
    p_kind: kind,
    p_hash: hash,
    p_facts: facts.map((f) => ({
      path: f.path,
      value: f.value === null || f.value === undefined ? null : String(f.value),
      confidence: f.confidence ?? null,
      source_url: f.sourceUrl ?? null,
      quote: f.quote ?? null,
    })),
  });

export const recordUnchanged = (domain: string, kind: string) =>
  rpc<null>("record_unchanged", { p_domain: domain, p_kind: kind });

export const recordFailure = (domain: string, kind: string, reason: string) =>
  rpc<null>("record_failure", { p_domain: domain, p_kind: kind, p_reason: reason });

export const watchCompany = (licenseKey: string, domain: string) =>
  rpc<null>("watch_company", { p_license_key: licenseKey, p_domain: domain });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type StoredFact = {
  path: string; value: string | null; confidence: number | null;
  source_url: string | null; quote: string | null; kind: string; updated_at: string;
};

export type StoredChange = {
  at: string; company_domain?: string; kind: string; path: string;
  old_value: string | null; new_value: string | null;
  source_url: string | null; quote: string | null;
};

export const companyFacts = (domain: string) =>
  rpc<StoredFact[]>("company_facts", { p_domain: domain });

export const companyChanges = (domain: string, limit = 200) =>
  rpc<StoredChange[]>("company_changes", { p_domain: domain, p_limit: limit });

export const watchlistChanges = (licenseKey: string, since: Date, limit = 200) =>
  rpc<StoredChange[]>("watchlist_changes", {
    p_license_key: licenseKey, p_since: since.toISOString(), p_limit: limit,
  });

export const vendorAdopters = (vendor: string) =>
  rpc<{ company_domain: string; source_url: string | null; updated_at: string }[]>(
    "vendor_adopters", { p_vendor: vendor },
  );

export const crawlStats = () =>
  rpc<{ companies: number; surfaces: number; facts: number; changes: number; due: number }[]>(
    "crawl_stats", {},
  );

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The current 12h window, as a fixed UTC boundary (00:00 or 12:00).
 *
 * Deliberately NOT "now minus 12 hours": a fixed boundary means a surface is
 * claimed exactly once per window however many times the endpoint is invoked,
 * and every customer sees the same "last updated" instant rather than a time
 * that depends on when their own crawl happened to run.
 */
export function currentWindow(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() < 12 ? 0 : 12);
  return d;
}
