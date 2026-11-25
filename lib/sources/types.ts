/**
 * The adapter contract.
 *
 * Breadth is only cheap if sources are DATA, not code. Every source in the
 * catalog shares one shape — resolve a URL, fetch it, emit facts — so an
 * adapter is 10-25 lines of config rather than a module. One fetcher, one
 * differ, one writer serve all of them.
 *
 * Two rules keep it honest:
 *  - `url()` returns null when the adapter does not apply to a company (no npm
 *    package, no app-store listing). Not applicable is not a failure.
 *  - every Fact carries `sourceUrl`, and anything a human will read carries a
 *    `quote`. A number we cannot point at is a number we do not publish.
 */

/**
 * What we know about a company. `domain` is the primary key; everything else is
 * an optional handle for sources keyed on something other than the domain, and
 * is discovered once then cached.
 */
export type Company = {
  domain: string;
  name?: string;
  category?: string;
  /** GitHub org, when it differs from the owner in `github`. */
  githubOrg?: string;
  /** Job board. Phase 0: guessing token === company name resolved 6/7. */
  ats?: { provider: "greenhouse" | "lever" | "ashby"; token: string };
  github?: string;        // "vercel/next.js"
  npm?: string;           // "next"
  pypi?: string;          // "requests"
  dockerRepo?: string;    // "library/postgres"
  appStoreId?: string;    // "1232780281"
  wpSlug?: string;        // "woocommerce"
  amoSlug?: string;       // "grammarly-1"
  vscodeExt?: string;     // "GitHub.copilot"
  statusHost?: string;    // "www.githubstatus.com" — must be discovered, not guessed
  wikipedia?: string;     // "Notion_(productivity_software)"
  /**
   * SEC Central Index Key, 10 digits. Resolved by `corporate.sec` from the
   * company's OWN filings, never from a name match — see lib/sources/financial.ts.
   * Absent for every private company, which is why financial facts are absent too.
   */
  cik?: string;           // "0001477333"
  /**
   * Registered legal name WITH its company-type suffix, e.g. "Monzo Bank
   * Limited". Only ever promoted from a corroborated registry match, because
   * it is what the legal adapters query — and a legal source answering about
   * the wrong entity is the most damaging error this product can make.
   */
  legalName?: string;
};

/** A single normalised observation. These are what we diff and what we sell. */
/**
 * Extractor version.
 *
 * **Bump this whenever a change to extraction logic could alter a value for
 * unchanged input.** When the stored version differs from this one, the store
 * updates the value but records NO change — because our parser changed, not
 * the world, and the change feed is the one thing customers pay for.
 *
 * This is not hypothetical. Tightening nonce detection removed fake vendors
 * from 70 companies and fixing locale validation corrected 14 more; without
 * this guard all 151 were written to `changes` as though those companies had
 * done something, on a day none of them had.
 *
 * History: 1 — initial. 2 — nonce detection, locale ISO-639-1 validation,
 * GLEIF exact-match-only, VAT-derived country, sitemap-index phrasing.
 * 3 — an ambiguous GLEIF match now contributes no identity facts at all.
 * 4 — GLEIF corroboration: sole-candidate, single-country group, or ccTLD
 *     agreement resolve soundly; everything else is a low-confidence lead.
 */
export const EXTRACTOR_VERSION = 4;

export type Fact = {
  /** Dotted, stable, machine-readable. e.g. "pricing.tier.pro.amount_cents" */
  path: string;
  value: string | number | boolean | null;
  /** 0-1. Below 1 means "parsed, not certain" and the UI must say so. */
  confidence?: number;
  sourceUrl?: string;
  /** Verbatim text from the source supporting the value. */
  quote?: string;
};

export type AdapterFormat = "json" | "text" | "dns-txt" | "dns-mx";

export type Adapter = {
  /** Stable id, also the `surfaces.kind` value. */
  kind: string;
  /** Which dossier module this feeds (1-14 in the plan). For the UI. */
  module: string;
  /** Human label for the "sources behind this number" disclosure. */
  label: string;
  cadence: "12h" | "daily" | "weekly" | "monthly";
  /** A = reliable, B = fragile (degrade silently), C = costs credits. */
  tier: "A" | "B" | "C";
  format: AdapterFormat;
  /** Target, or null when not applicable to this company. */
  url: (c: Company) => string | null;
  /** Per-source politeness. Enforced centrally so no adapter can hammer. */
  rate?: { rpm?: number; minIntervalMs?: number };
  /**
   * Extra request headers. A FUNCTION, not an object, so a credential is read
   * at call time rather than frozen at import — which matters because the
   * GitHub token lifts the rate limit from 60/hr to 5,000/hr and may be added
   * to the environment after the process starts.
   */
  headers?: () => Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
  /** Parse a successful body into facts. Must never throw. */
  extract: (body: unknown, ctx: { company: Company; url: string; raw: string }) => Fact[];
};

/** Result of running one adapter against one company. */
export type AdapterRun =
  | { kind: string; status: "ok"; facts: Fact[]; hash: string; raw: string; url: string; ms: number }
  | { kind: string; status: "skip"; reason: "not-applicable"; ms: number }
  | { kind: string; status: "unchanged"; hash: string; ms: number }
  | { kind: string; status: "fail"; reason: string; detail: string; retryAfterSec?: number; ms: number };

/** Small helpers adapters use constantly. Kept here so adapters stay one-liners. */
export const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Narrow an unknown response body to an object, or an empty one.
 *
 * `(body as Shape).field` THROWS when the body is null — and a third-party API
 * returns null, a bare string or an unexpected array far more often than its
 * docs suggest. The runner catches it, but a thrown extract silently loses that
 * metric for the window, so adapters guard at the source instead.
 */
export const asObj = <T extends object>(b: unknown): Partial<T> =>
  b !== null && typeof b === "object" && !Array.isArray(b) ? (b as Partial<T>) : {};

/** Narrow an unknown response body to an array, or an empty one. */
export const asArr = <T>(b: unknown): T[] => (Array.isArray(b) ? (b as T[]) : []);

/**
 * An array of OBJECTS, with non-objects dropped.
 *
 * `asArr` only guards the outer shape: `[null]` still crashed an adapter that
 * mapped over elements and read a field. Use this wherever element fields are
 * dereferenced — which is almost every list-shaped API response.
 */
export const asObjArr = <T extends object>(b: unknown): T[] =>
  asArr<unknown>(b).filter((x): x is T => x !== null && typeof x === "object");

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", rsquo: "\u2019",
  lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", trade: "\u2122",
  reg: "\u00ae", copy: "\u00a9", times: "\u00d7", shy: "",
};

/**
 * Decode HTML entities in extracted text.
 *
 * Not cosmetic: an un-decoded `&#8211;` makes the DIFF noisy (the same headline
 * reads as two different strings depending on how the page encoded it) and puts
 * literal `&nbsp;` in front of a paying customer.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Clip a quote to something publishable: short, attributed, single-line. */
export const quote = (s: string, max = 180): string =>
  decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, max);
