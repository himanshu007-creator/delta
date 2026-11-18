/**
 * The one HTTP client every source adapter uses.
 *
 * Generalises the guards that were inline in research.ts's fetchText (timeout,
 * byte cap, content-type gate, generic UA) and adds the three things that did
 * not exist and that polling ~50 third-party sources every 12h absolutely
 * requires:
 *
 *  1. RETRIES with exponential backoff + jitter.
 *  2. Retry-After OBEDIENCE. Phase 0 proved the cost of ignoring this: sustained
 *     probing of GDELT got us IP-blocked, and a single request after a 35s
 *     cooldown still returned 429 (see PHASE0.md).
 *  3. PLAIN-TEXT ERROR DETECTION. GDELT answers 429 with prose, not JSON, so a
 *     naive JSON.parse throws on the error path and the real cause is lost.
 *
 * It also returns a CONTENT HASH on every response, which is what makes wide
 * coverage affordable: unchanged bytes are detected before anything is parsed
 * or sent to an LLM, and most surfaces are unchanged most windows.
 *
 * This module NEVER throws. A failed fetch is a value, so one dead upstream can
 * never take down a crawl window.
 */

import { createHash } from "node:crypto";
import { parseDuration } from "./limiter";

/**
 * Generic, honest, and contactable. Never identify the customer to the site
 * being fetched — a competitor must not be able to see who is watching them.
 */
export const BOT_UA = "Mozilla/5.0 (compatible; DeltaBot/1.0; +https://example.com/bot)";

export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_BYTES = 2_000_000;

export type FetchFailReason =
  | "http"         // a 4xx/5xx we should not retry
  | "rate-limited" // 429/503 — back off, honour Retry-After
  | "timeout"
  | "network"
  | "too-large"
  | "wrong-type"
  | "not-json";    // 200 (or 429) whose body is not JSON at all

export type FetchResult<T> =
  | {
      ok: true;
      status: number;
      /** Final URL after redirects — a redirect is itself a signal. */
      url: string;
      body: T;
      /** Raw text, kept so the body can be archived to R2 unparsed. */
      raw: string;
      bytes: number;
      /** sha256 of the raw body. The differ's fast path. */
      hash: string;
      ms: number;
    }
  | {
      ok: false;
      status: number;
      reason: FetchFailReason;
      detail: string;
      /** Seconds the server asked us to wait, when it said so. */
      retryAfterSec?: number;
      ms: number;
    };

export type FetchOpts = {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Total attempts including the first. 1 disables retrying. */
  attempts?: number;
  /** Caller-owned abort, e.g. the cron window closing. */
  signal?: AbortSignal;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

/** Retry only what retrying can fix. A 404 is an answer, not a failure to retry. */
const RETRYABLE: ReadonlySet<FetchFailReason> = new Set(["rate-limited", "timeout", "network"]);
const isRetryableStatus = (s: number) => s === 408 || s === 429 || s === 425 || (s >= 500 && s < 600);

async function once(url: string, o: FetchOpts): Promise<FetchResult<string>> {
  const t0 = Date.now();
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES;

  // Compose the caller's abort with our timeout so either can cancel.
  const timer = AbortSignal.timeout(timeoutMs);
  const signal = o.signal ? AbortSignal.any([o.signal, timer]) : timer;

  try {
    const res = await fetch(url, {
      method: o.method ?? "GET",
      headers: { "user-agent": BOT_UA, ...(o.accept ? { accept: o.accept } : {}), ...o.headers },
      body: o.body,
      signal,
      redirect: "follow",
    });

    const retryAfterSec = parseDuration(res.headers.get("retry-after"));

    if (res.status === 429 || res.status === 503) {
      // Read the body: the useful diagnostic is often in prose here, which is
      // exactly how GDELT reports its limit.
      const text = await res.text().catch(() => "");
      return {
        ok: false, status: res.status, reason: "rate-limited",
        detail: text.slice(0, 200).replace(/\s+/g, " ").trim() || res.statusText,
        retryAfterSec, ms: Date.now() - t0,
      };
    }

    if (!res.ok) {
      // fetch() usually leaves statusText empty, so name the status explicitly
      // or every failure logs an unreadable bare "http:".
      return { ok: false, status: res.status, reason: "http", detail: res.statusText || `HTTP ${res.status}`, retryAfterSec, ms: Date.now() - t0 };
    }

    if (o.accept) {
      const got = res.headers.get("content-type") ?? "";
      const wantsJson = o.accept.includes("json");
      const wantsText = o.accept.includes("html") || o.accept.includes("text") || o.accept.includes("xml");
      // Only reject on a confident mismatch. Plenty of correct endpoints serve
      // JSON as text/plain, and rejecting those would lose real sources.
      if (wantsJson && got && !got.includes("json") && !got.includes("text") && !got.includes("javascript")) {
        return { ok: false, status: res.status, reason: "wrong-type", detail: got, ms: Date.now() - t0 };
      }
      if (wantsText && got && !/html|text|xml|json/.test(got)) {
        return { ok: false, status: res.status, reason: "wrong-type", detail: got, ms: Date.now() - t0 };
      }
    }

    // Cheap pre-check, then the real one — Content-Length is often absent or lies.
    const declared = Number(res.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, status: res.status, reason: "too-large", detail: `content-length ${declared} > ${maxBytes}`, ms: Date.now() - t0 };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return { ok: false, status: res.status, reason: "too-large", detail: `${buf.byteLength} > ${maxBytes}`, ms: Date.now() - t0 };
    }

    const raw = new TextDecoder().decode(buf);
    return {
      ok: true, status: res.status, url: res.url || url, body: raw, raw,
      bytes: buf.byteLength, hash: sha256(raw), ms: Date.now() - t0,
    };
  } catch (e) {
    const err = e as Error;
    // A caller-initiated abort must propagate, not be swallowed as a retryable
    // network blip — otherwise a closing cron window keeps fetching.
    if (o.signal?.aborted) return { ok: false, status: 0, reason: "network", detail: "aborted by caller", ms: Date.now() - t0 };
    const reason: FetchFailReason = err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : "network";
    return { ok: false, status: 0, reason, detail: `${err.name}: ${err.message}`.slice(0, 160), ms: Date.now() - t0 };
  }
}

/** Fetch text with retries. Never throws. */
export async function fetchRaw(url: string, o: FetchOpts = {}): Promise<FetchResult<string>> {
  const attempts = Math.max(1, o.attempts ?? 3);
  let last: FetchResult<string> | null = null;

  for (let i = 0; i < attempts; i++) {
    const r = await once(url, o);
    if (r.ok) return r;
    last = r;
    if (!RETRYABLE.has(r.reason) && !isRetryableStatus(r.status)) break;
    if (i === attempts - 1) break;

    // The server's own number wins over our guess, always — that is the whole
    // point of Retry-After. Cap it so one rude header cannot stall a window.
    const backoffMs = r.retryAfterSec !== undefined
      ? Math.min(r.retryAfterSec * 1000, 60_000)
      : Math.min(1000 * 2 ** i, 15_000) + Math.random() * 400; // jitter: avoid lockstep retries across adapters
    try { await sleep(backoffMs, o.signal); } catch { break; }
  }
  return last ?? { ok: false, status: 0, reason: "network", detail: "no attempt made", ms: 0 };
}

/**
 * Fetch and parse JSON. Returns `not-json` rather than throwing when the body
 * is prose — which is how several real sources report errors.
 */
export async function fetchJson<T = unknown>(url: string, o: FetchOpts = {}): Promise<FetchResult<T>> {
  const r = await fetchRaw(url, { accept: "application/json", ...o });
  if (!r.ok) return r;
  const t = r.raw.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) {
    return { ok: false, status: r.status, reason: "not-json", detail: r.raw.slice(0, 160).replace(/\s+/g, " ").trim(), ms: r.ms };
  }
  try {
    return { ...r, body: JSON.parse(t) as T };
  } catch (e) {
    return { ok: false, status: r.status, reason: "not-json", detail: (e as Error).message.slice(0, 160), ms: r.ms };
  }
}

/**
 * Fetch BINARY content (images, PDFs) as bytes.
 *
 * Needed because fetchRaw decodes the body with TextDecoder, which is LOSSY for
 * binary: invalid UTF-8 sequences become U+FFFD and the original bytes cannot be
 * recovered. A screenshot round-tripped through fetchRaw produced a corrupt PNG
 * that a vision model would silently fail on. Shares every guard with the text
 * path — timeout, size cap, retries, Retry-After.
 */
export async function fetchBinary(
  url: string,
  o: FetchOpts = {},
): Promise<{ ok: true; status: number; url: string; bytes: Uint8Array; contentType: string; hash: string; ms: number }
        | { ok: false; status: number; reason: FetchFailReason; detail: string; retryAfterSec?: number; ms: number }> {
  const attempts = Math.max(1, o.attempts ?? 2);
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = o.maxBytes ?? 10_000_000;
  let last: { status: number; reason: FetchFailReason; detail: string; retryAfterSec?: number; ms: number } | null = null;

  for (let i = 0; i < attempts; i++) {
    const t0 = Date.now();
    const timer = AbortSignal.timeout(timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timer]) : timer;
    try {
      const res = await fetch(url, {
        method: o.method ?? "GET",
        headers: { "user-agent": BOT_UA, ...(o.accept ? { accept: o.accept } : {}), ...o.headers },
        body: o.body, signal, redirect: "follow",
      });
      const retryAfterSec = parseDuration(res.headers.get("retry-after"));
      if (res.status === 429 || res.status === 503) {
        last = { status: res.status, reason: "rate-limited", detail: res.statusText || `HTTP ${res.status}`, retryAfterSec, ms: Date.now() - t0 };
      } else if (!res.ok) {
        return { ok: false, status: res.status, reason: "http", detail: res.statusText || `HTTP ${res.status}`, retryAfterSec, ms: Date.now() - t0 };
      } else {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > maxBytes) {
          return { ok: false, status: res.status, reason: "too-large", detail: `${buf.byteLength} > ${maxBytes}`, ms: Date.now() - t0 };
        }
        const bytes = new Uint8Array(buf);
        return {
          ok: true, status: res.status, url: res.url || url, bytes,
          contentType: res.headers.get("content-type") ?? "",
          hash: createHash("sha256").update(bytes).digest("hex"),
          ms: Date.now() - t0,
        };
      }
    } catch (e) {
      const err = e as Error;
      if (o.signal?.aborted) return { ok: false, status: 0, reason: "network", detail: "aborted by caller", ms: Date.now() - t0 };
      last = {
        status: 0,
        reason: err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : "network",
        detail: `${err.name}: ${err.message}`.slice(0, 160), ms: Date.now() - t0,
      };
    }
    if (i < attempts - 1) {
      const waitMs = last?.retryAfterSec !== undefined ? Math.min(last.retryAfterSec * 1000, 60_000) : Math.min(1000 * 2 ** i, 15_000);
      try { await sleep(waitMs, o.signal); } catch { break; }
    }
  }
  return { ok: false, ...(last ?? { status: 0, reason: "network" as FetchFailReason, detail: "no attempt made", ms: 0 }) };
}

/** Fetch HTML/XML/text. */
export const fetchText = (url: string, o: FetchOpts = {}) =>
  fetchRaw(url, { accept: "text/html,application/xhtml+xml,text/plain,application/xml", ...o });
