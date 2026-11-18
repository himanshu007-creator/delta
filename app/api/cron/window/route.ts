/**
 * The crawl window.
 *
 * Triggered at 00:00 and 12:00 UTC. Vercel Hobby allows one cron per DAY, so
 * the trigger lives in GitHub Actions (free, per-minute precision) and this is
 * just an authenticated endpoint.
 *
 * SELF-CHAINING: one invocation claims a batch, crawls it inside its 300s
 * budget, then fires an un-awaited request to itself for the next batch. One
 * endpoint, unbounded throughput, no queue service. The claim is atomic in SQL
 * (FOR UPDATE SKIP LOCKED), so overlapping invocations never double-fetch.
 *
 * No `export const runtime`: Cache Components rejects it.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ADAPTERS, byKind } from "@/lib/sources/registry";
import { runAdapter } from "@/lib/sources/run";
import type { Company } from "@/lib/sources/types";
import {
  claimSurfaces, currentWindow, recordFailure, recordSurface, recordUnchanged, storeConfigured,
  type ClaimedSurface,
} from "@/lib/store";

export const maxDuration = 300;

/** Surfaces per invocation. Small enough to finish well inside 300s. */
const BATCH = 40;
/** Parallel fetches. Kept modest: DNS degrades badly above this (measured). */
const CONCURRENCY = 6;
/** Stop chaining rather than run forever if something goes wrong. */
const MAX_CHAIN = 400;
/** Leave headroom so a slow source cannot push us past maxDuration. */
const TIME_BUDGET_MS = 240_000;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Unset in development so the endpoint is testable; REQUIRED in production,
  // or anyone could make us crawl the internet on demand.
  if (!secret) return process.env.NODE_ENV !== "production";
  const given =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret") ??
    "";
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function pooled<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Rebuild the Company the adapters need from the stored handles blob. */
function companyFrom(s: ClaimedSurface): Company {
  const h = (s.handles ?? {}) as Partial<Company>;
  return { ...h, domain: s.company_domain, name: s.name ?? h.name };
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  if (!storeConfigured()) {
    return NextResponse.json(
      { error: "store not configured", hint: "set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const t0 = Date.now();
  const { searchParams } = new URL(req.url);
  const chain = Number(searchParams.get("chain") ?? 0);
  const windowAt = currentWindow();

  const claimed = await claimSurfaces(windowAt, BATCH);
  if (!claimed.ok) {
    return NextResponse.json({ error: claimed.error }, { status: 502 });
  }
  const batch = claimed.data ?? [];
  if (batch.length === 0) {
    return NextResponse.json({
      window: windowAt.toISOString(), chain, claimed: 0, done: true,
      message: "nothing due — window complete",
    });
  }

  const deadline = AbortSignal.timeout(TIME_BUDGET_MS);
  let ok = 0, unchanged = 0, failed = 0, changes = 0, skipped = 0;

  await pooled(batch, CONCURRENCY, async (s) => {
    const adapter = byKind(s.kind);
    if (!adapter) {
      // The registry changed under a stored surface; retire it quietly.
      await recordFailure(s.company_domain, s.kind, "no such adapter");
      failed++;
      return;
    }
    const company = companyFrom(s);
    const r = await runAdapter(adapter, company, { lastHash: s.last_hash, signal: deadline });

    if (r.status === "unchanged") {
      // THE FAST PATH: no parse, no facts written, no LLM tokens.
      unchanged++;
      await recordUnchanged(s.company_domain, s.kind);
      return;
    }
    if (r.status === "skip") {
      skipped++;
      await recordFailure(s.company_domain, s.kind, "not-applicable");
      return;
    }
    if (r.status === "fail") {
      failed++;
      await recordFailure(s.company_domain, s.kind, r.reason);
      return;
    }
    const written = await recordSurface(s.company_domain, s.kind, r.hash, r.facts);
    if (written.ok) {
      ok++;
      changes += Number(written.data ?? 0);
    } else {
      failed++;
      console.warn(`[window] store write failed for ${s.company_domain}/${s.kind}: ${written.error}`);
    }
  });

  // Chain only while there is plainly more to do and we are inside the budget.
  const more = batch.length === BATCH && chain < MAX_CHAIN && Date.now() - t0 < TIME_BUDGET_MS;
  if (more) {
    const next = new URL(req.url);
    next.searchParams.set("chain", String(chain + 1));
    // UN-AWAITED on purpose: this invocation returns while the next begins, so
    // one trigger drains the queue without a queue service.
    void fetch(next.toString(), {
      headers: {
        ...(process.env.CRON_SECRET ? { "x-cron-secret": process.env.CRON_SECRET } : {}),
      },
    }).catch(() => { /* the next window retries anything missed */ });
  }

  return NextResponse.json({
    window: windowAt.toISOString(),
    chain,
    claimed: batch.length,
    ok, unchanged, failed, skipped,
    changesRecorded: changes,
    chained: more,
    ms: Date.now() - t0,
    adaptersAvailable: ADAPTERS.length,
  });
}

/** GitHub Actions posts; same work either way. */
export const POST = GET;
