/**
 * The runner: the only code that executes an adapter.
 *
 * Every source is a black box with the same three holes — `url()`, a format,
 * and `extract()`. This file supplies everything else exactly once: politeness,
 * fetching, retries, content hashing, unchanged-detection and error
 * containment. Wiring a new metric therefore means adding an object to the
 * registry; it never means touching this file.
 *
 * The unchanged-fast-path is what makes ~50 sources affordable. If the content
 * hash matches what we stored last window we return immediately — no parse, no
 * fact-writing, and above all no LLM tokens. Most surfaces do not change most
 * windows, so most work costs one conditional-free GET.
 */

import { resolveMx, resolveTxt } from "node:dns/promises";
import { fetchJson, fetchText } from "../fetch";
import type { Adapter, AdapterRun, Company, Fact } from "./types";

/**
 * Per-HOST last-hit clock, so politeness is enforced across adapters rather
 * than per adapter. Three adapters pointed at one domain must not become three
 * simultaneous requests to it.
 */
const lastHit = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(target: string): string {
  try { return new URL(target).host; } catch { return target; }
}

async function bePolite(target: string, minIntervalMs?: number): Promise<void> {
  if (!minIntervalMs) return;
  const host = hostOf(target);
  const since = Date.now() - (lastHit.get(host) ?? 0);
  if (since < minIntervalMs) await sleep(minIntervalMs - since);
  lastHit.set(host, Date.now());
}

export type RunOpts = {
  /** Hash stored from the previous window. Matching it short-circuits everything. */
  lastHash?: string | null;
  signal?: AbortSignal;
};

/** Run one adapter against one company. NEVER throws. */
export async function runAdapter(a: Adapter, c: Company, o: RunOpts = {}): Promise<AdapterRun> {
  const t0 = Date.now();
  const target = a.url(c);

  // Not applicable is a legitimate outcome, not an error. Most companies have
  // no npm package or app-store listing, and that must stay silent.
  if (target === null) return { kind: a.kind, status: "skip", reason: "not-applicable", ms: 0 };

  await bePolite(target, a.rate?.minIntervalMs);

  const common = {
    timeoutMs: a.timeoutMs, maxBytes: a.maxBytes, attempts: a.attempts, signal: o.signal,
    headers: a.headers?.(),
  };

  // --- DNS has no HTTP body, so it gets its own small path ------------------
  if (a.format === "dns-txt" || a.format === "dns-mx") {
    try {
      const records = a.format === "dns-mx"
        ? (await resolveMx(target)).sort((x, y) => x.priority - y.priority).map((m) => [m.exchange])
        : await resolveTxt(target);
      const raw = JSON.stringify(records.map((r) => r.join("")).sort());
      const hash = await sha256(raw);
      if (o.lastHash && o.lastHash === hash) return { kind: a.kind, status: "unchanged", hash, ms: Date.now() - t0 };
      const label = `dns:${a.format === "dns-mx" ? "MX" : "TXT"}:${target}`;
      return { kind: a.kind, status: "ok", facts: safeExtract(a, records, c, label, raw), hash, raw, url: label, ms: Date.now() - t0 };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return { kind: a.kind, status: "fail", reason: err.code ?? "dns", detail: err.message?.slice(0, 160) ?? "dns failure", ms: Date.now() - t0 };
    }
  }

  // --- HTTP ----------------------------------------------------------------
  const res = a.format === "json" ? await fetchJson(target, common) : await fetchText(target, common);

  if (!res.ok) {
    return {
      kind: a.kind, status: "fail", reason: res.reason, detail: res.detail,
      retryAfterSec: res.retryAfterSec, ms: Date.now() - t0,
    };
  }

  // THE FAST PATH. No parse, no facts, no tokens.
  if (o.lastHash && o.lastHash === res.hash) {
    return { kind: a.kind, status: "unchanged", hash: res.hash, ms: Date.now() - t0 };
  }

  return {
    kind: a.kind, status: "ok",
    facts: safeExtract(a, res.body, c, res.url, res.raw),
    hash: res.hash, raw: res.raw, url: res.url, ms: Date.now() - t0,
  };
}

/**
 * An adapter's extract() is third-party-shaped parsing and will eventually meet
 * a response it does not expect. One bad parse must cost that one metric, never
 * the window.
 */
function safeExtract(a: Adapter, body: unknown, company: Company, url: string, raw: string): Fact[] {
  try {
    const facts = a.extract(body, { company, url, raw });
    // Provenance is not optional: a number we cannot point at is one we will
    // not publish, so backfill the source URL rather than emit a bare value.
    return facts.filter((f) => f && f.path).map((f) => ({ ...f, sourceUrl: f.sourceUrl ?? url }));
  } catch (e) {
    console.warn(`[${a.kind}] extract failed for ${company.domain}: ${(e as Error).message}`);
    return [];
  }
}

async function sha256(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}

/** Run every applicable adapter for a company, politely and in sequence. */
export async function runCompany(
  c: Company,
  adapters: readonly Adapter[],
  hashes: Record<string, string | null> = {},
  signal?: AbortSignal,
): Promise<AdapterRun[]> {
  const out: AdapterRun[] = [];
  for (const a of adapters) {
    if (signal?.aborted) break;
    out.push(await runAdapter(a, c, { lastHash: hashes[a.kind], signal }));
  }
  return out;
}
