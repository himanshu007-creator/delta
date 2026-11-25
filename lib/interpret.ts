/**
 * Facts into meaning.
 *
 * A page that lists `security.dmarc_policy = reject` next to
 * `site.ai_crawlers_blocked = 0` has told the reader nothing: both are true,
 * neither is a sentence, and a marketer does not know which of the forty rows
 * to look at. The raw table is still available further down the page — but the
 * top of the page has to say what the data MEANS.
 *
 * So each signal carries three things: a headline a human would say out loud,
 * one line on why it matters, and the source it came from. A signal is emitted
 * only when the evidence for it exists; nothing here fabricates a default or
 * fills a gap with a guess.
 */

import type { FactMap } from "./cached-dossier";
import { normaliseCountry, localeCountry } from "./worldmap";
import type { Footprint } from "../app/footprint";

export type Signal = {
  id: string;
  /** The category, for the tile's eyebrow. */
  label: string;
  /** What a person would actually say. Short. */
  headline: string;
  /** Why it matters, one line. This is the part that does the work. */
  meaning: string;
  tone: "neutral" | "good" | "warn";
  /** Bento sizing. At most two `lg` per page or the grid loses its rhythm. */
  size: "lg" | "sm";
  href?: string;
  sourceUrl?: string | null;
  confidence?: number | null;
};

const str = (f: FactMap, p: string): string | null => f.get(p)?.value ?? null;
const num = (f: FactMap, p: string): number | null => {
  const v = f.get(p)?.value;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (f: FactMap, p: string): boolean | null => {
  const v = str(f, p);
  return v === null ? null : v === "true" || v === "t";
};
const src = (f: FactMap, p: string) => f.get(p)?.sourceUrl ?? null;
const conf = (f: FactMap, p: string) => f.get(p)?.confidence ?? null;
const list = (f: FactMap, p: string): string[] =>
  (str(f, p) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const money = (minor: number, currency = "USD") => {
  const major = minor / 100;
  const sym = currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency === "INR" ? "₹" : "$";
  return `${sym}${major % 1 === 0 ? major.toFixed(0) : major.toFixed(2)}`;
};

/**
 * The signals, in the order they should be read.
 *
 * Ordered by what a competitor-watcher asks first — how do they charge, what
 * do they run on, how big are they — not by which adapter happened to run.
 */
export function interpret(f: FactMap): Signal[] {
  const out: Signal[] = [];

  // --- Pricing. The first question anyone asks about a competitor. --------
  {
    const visible = bool(f, "pricing.visible");
    const tiers = num(f, "pricing.tiers.count");
    const cheapest = num(f, "pricing.cheapest_paid_minor");
    const currency = str(f, "pricing.currency_observed") ?? "USD";

    if (visible && tiers && tiers > 0) {
      out.push({
        id: "pricing",
        label: "Pricing",
        headline:
          cheapest !== null && cheapest > 0
            ? `${tiers} tiers, from ${money(cheapest, currency)}`
            : `${tiers} published tiers`,
        meaning:
          "Published pricing means self-serve buyers, and it means a price change is public the day it happens.",
        tone: "neutral",
        size: "lg",
        sourceUrl: src(f, "pricing.tiers.count") ?? src(f, "pricing.visible"),
        confidence: conf(f, "pricing.cheapest_paid_minor"),
      });
    } else if (visible === false) {
      out.push({
        id: "pricing",
        label: "Pricing",
        headline: "Not published",
        meaning:
          "No public price list points to sales-led, negotiated deals — so discounting is invisible and slower to react.",
        tone: "warn",
        size: "lg",
        sourceUrl: src(f, "pricing.visible"),
      });
    }
  }

  // --- The vendor stack. The fact nobody else has. ------------------------
  {
    const count = num(f, "stack.vendors.count");
    const vendors = list(f, "stack.vendors.list");
    if (count && count > 0) {
      // Name the ones a reader will recognise and find telling, not the first
      // five alphabetically — "adobe, apple, atlassian" says nothing.
      const NOTABLE = new Set([
        "anthropic", "openai", "cursor", "stripe", "rippling", "carta", "wiz",
        "hackerone", "launchdarkly", "snowflake", "databricks", "workday", "gusto",
        "salesforce", "hubspot", "segment", "datadog", "sentry", "vercel", "figma",
      ]);
      // Capitalised: "Including anthropic, openai" read like a typo mid-sentence.
      const pretty = (v: string) =>
        v === "openai" ? "OpenAI"
        : v === "hackerone" ? "HackerOne"
        : v === "launchdarkly" ? "LaunchDarkly"
        : v === "hubspot" ? "HubSpot"
        : v.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      const notable = vendors.filter((v) => NOTABLE.has(v)).slice(0, 3).map(pretty);
      out.push({
        id: "stack",
        label: "Vendor stack",
        headline: `${count} vendors`,
        meaning: notable.length
          ? `Including ${notable.join(", ")} — back-office purchases, read from public DNS, that script detection cannot see.`
          : "Read from public DNS verification records — purchases that frontend script detection cannot see.",
        tone: "neutral",
        size: "lg",
        // No href: linking to an arbitrary "first notable vendor" is a click
        // nobody asked for, and the chips below link every one of them.
        sourceUrl: src(f, "stack.vendors.count"),
      });
    }
  }

  // --- Reach. A rank is meaningless without a band. ----------------------
  {
    const rank = num(f, "attention.tranco.rank");
    if (rank) {
      const band =
        rank <= 1_000 ? "top 1,000 sites worldwide"
        : rank <= 10_000 ? "top 10,000 sites worldwide"
        : rank <= 100_000 ? "top 100,000 sites worldwide"
        : "outside the top 100,000";
      out.push({
        id: "reach",
        label: "Reach",
        headline: `#${rank.toLocaleString("en-GB")}`,
        meaning: `Tranco rank — ${band}. A durable traffic proxy, averaged over months rather than a single day.`,
        tone: rank <= 10_000 ? "good" : "neutral",
        size: "sm",
        sourceUrl: src(f, "attention.tranco.rank"),
      });
    }
  }

  // --- Email security, as a proxy for security maturity. -----------------
  {
    const policy = str(f, "security.dmarc_policy");
    if (policy) {
      const enforced = policy === "reject" || policy === "quarantine";
      out.push({
        id: "dmarc",
        label: "Email security",
        headline: policy === "reject" ? "DMARC enforced" : policy === "quarantine" ? "DMARC quarantine" : "DMARC monitor only",
        meaning: enforced
          ? "Spoofed mail in their name is rejected outright — a deliberate, maintained control."
          : "DMARC is published but not enforced, so anyone can still send mail as them. A gap, and a common one.",
        tone: enforced ? "good" : "warn",
        size: "sm",
        sourceUrl: src(f, "security.dmarc_policy"),
      });
    }
  }

  // --- AI stance. Nobody is tracking this, and it is about to matter. ----
  {
    const blocked = num(f, "site.ai_crawlers_blocked");
    if (blocked !== null) {
      out.push({
        id: "ai",
        label: "AI stance",
        headline: blocked === 0 ? "Open to AI crawlers" : `Blocks ${blocked}`,
        meaning:
          blocked === 0
            ? "robots.txt blocks no AI crawler, so their content is feeding assistants — and is quotable in answers about this market."
            : "They have chosen to block AI crawlers, which keeps them out of assistant answers about their own category.",
        tone: "neutral",
        size: "sm",
        sourceUrl: src(f, "site.ai_crawlers_blocked"),
      });
    }
  }

  // --- Machine-readable self-description. --------------------------------
  {
    if (bool(f, "product.llmstxt.present")) {
      const links = num(f, "product.llmstxt.links");
      out.push({
        id: "llmstxt",
        label: "Machine-readable",
        headline: "Publishes llms.txt",
        meaning: links
          ? `${links.toLocaleString("en-GB")} curated links written for models — their own summary of what they sell, and it changes when positioning does.`
          : "A curated summary written for models, which changes when their positioning does.",
        tone: "good",
        size: "sm",
        sourceUrl: src(f, "product.llmstxt.present"),
      });
    }
  }

  // --- Site scale. ------------------------------------------------------
  {
    const urls = num(f, "site.sitemap.urls");
    const sections = num(f, "site.sections.count");
    // A sitemap INDEX lists child sitemaps, not pages. Adyen's 21 entries are
    // 21 locale sitemaps covering thousands of URLs, so calling them
    // "21 indexed URLs" understated it by three orders of magnitude.
    const isIndex = bool(f, "site.sitemap.is_index") === true;

    if (urls || sections) {
      out.push({
        id: "scale",
        label: "Site scale",
        headline: isIndex && urls
          ? `${urls.toLocaleString("en-GB")} sitemaps`
          : urls
            ? `${urls.toLocaleString("en-GB")} indexed URLs`
            : `${sections} sections`,
        meaning: isIndex
          ? "A sitemap index, not a page list — each entry is its own sitemap, usually one per locale or content type."
          : sections
            ? `Across ${sections} sections. Content volume is the cheapest read on how much they invest in organic acquisition.`
            : "Content volume is the cheapest read on how much they invest in organic acquisition.",
        tone: "neutral",
        size: "sm",
        sourceUrl: src(f, "site.sitemap.urls") ?? src(f, "site.sections.count"),
      });
    }
  }

  // --- Unannounced surface area. ---------------------------------------
  {
    const subs = num(f, "signals.subdomains.count");
    if (subs && subs > 0) {
      out.push({
        id: "subdomains",
        label: "Unannounced",
        headline: `${subs} subdomains`,
        meaning:
          "From certificate transparency logs. A certificate for a product that has not launched is the earliest public signal there is.",
        tone: "neutral",
        size: "sm",
        sourceUrl: src(f, "signals.subdomains.count"),
      });
    }
  }

  // --- Developer surface. ----------------------------------------------
  {
    const docs = list(f, "discovered.docs_host")[0];
    if (docs) {
      out.push({
        id: "docs",
        label: "Developer surface",
        headline: "Public API docs",
        meaning: `Documentation at ${docs}. A developer-facing product, so new endpoints often appear there before any announcement.`,
        tone: "neutral",
        size: "sm",
        sourceUrl: src(f, "discovered.docs_host"),
      });
    }
  }

  // --- Operational transparency. ---------------------------------------
  {
    const status = str(f, "discovered.status_host");
    if (status) {
      out.push({
        id: "status",
        label: "Reliability",
        headline: "Public status page",
        meaning:
          "Incident history is public, which makes their uptime directly comparable with yours — and it is rarely flattering to whoever has more incidents.",
        tone: "good",
        size: "sm",
        sourceUrl: src(f, "discovered.status_host"),
      });
    }
  }

  // --- Mobile. ---------------------------------------------------------
  {
    if (bool(f, "discovered.has_ios_app")) {
      out.push({
        id: "app",
        label: "Mobile",
        headline: "Ships an iOS app",
        meaning:
          "Found via their own app-site-association file, which also unlocks App Store ratings, reviews and release notes.",
        tone: "neutral",
        size: "sm",
        sourceUrl: src(f, "discovered.has_ios_app"),
      });
    }
  }

  return out;
}

/**
 * The one-line identity row: who this legally is.
 *
 * Kept separate from the signals because it is description rather than
 * analysis, and because an unresolved legal entity must read as unresolved.
 */
export function identityOf(f: FactMap) {
  const legal = str(f, "corporate.legal_name");
  const matched = str(f, "corporate.gleif.matched");
  const candidateName = str(f, "corporate.gleif.candidate_name");
  return {
    legalName: legal,
    tradingName: str(f, "corporate.trading_name"),
    vat: str(f, "corporate.vat_id"),
    founded: str(f, "corporate.founded"),
    type: str(f, "identity.company_type"),
    /** Registry lookup ran and matched no entity by this name. */
    unresolved: !legal && matched === "false",
    candidates: num(f, "corporate.gleif.candidates"),
    /**
     * An exact-name entity exists in the registry but could not be tied to
     * this company. Shown as a LEAD, never as the identity — the Belgian
     * company named "Stripe" is the reason this distinction exists.
     */
    candidateName: legal ? null : candidateName,
    candidateCountry: str(f, "corporate.gleif.candidate_country"),
    legalSource: src(f, "corporate.legal_name"),
    legalConfidence: conf(f, "corporate.legal_name"),
    /** How the resolution was corroborated, when it was. */
    basis: str(f, "corporate.gleif.basis"),
  };
}

/**
 * Where the company is, from the strongest available evidence.
 *
 * Priority matters: a registry filing beats a VAT prefix, which beats an
 * address block on a marketing page. The basis is reported so a reader can
 * weigh it.
 */
export function footprintOf(f: FactMap): Footprint {
  /*
   * Self-published evidence outranks a registry lookup here, which is the
   * opposite of what you would expect — because the weak link is entity
   * RESOLUTION, not the registry. A VAT id printed in a company's own footer
   * is unambiguously theirs; a registry entity that merely shares their name
   * may belong to anyone. The adapter now withholds country entirely on an
   * ambiguous match, and this guard is the second line of defence.
   */
  const ambiguousRegistry = str(f, "corporate.gleif.ambiguous") === "true";
  const candidates: Array<[string, string]> = [
    ...(ambiguousRegistry ? [] : ([["geo.legal_country", "a registry filing"]] as Array<[string, string]>)),
    ["geo.vat_country", "their VAT identifier"],
    ["geo.country", "their published address"],
    ["geo.place_of_registration", "a statutory disclosure"],
  ];

  let registered: string | null = null;
  let basis: string | null = null;
  for (const [path, label] of candidates) {
    const iso = normaliseCountry(str(f, path));
    if (iso) {
      registered = iso;
      basis = label;
      break;
    }
  }

  // Markets from any locale carrying a region subtag, from either source.
  const markets = new Set<string>();
  for (const l of [...list(f, "geo.locales"), ...list(f, "site.sections")]) {
    const iso = localeCountry(l.replace(/^sitemap-|\.xml$/g, ""));
    if (iso) markets.add(iso);
  }

  return {
    registered,
    city: str(f, "geo.city"),
    markets: [...markets].sort(),
    basis,
  };
}

// ---------------------------------------------------------------------------
// Filed financials
// ---------------------------------------------------------------------------

export type FiledFigure = {
  path: string;
  label: string;
  /** The figure exactly as filed. Never rounded for storage, only for display. */
  value: number;
  unit: string;
  /** Year-over-year change, present only when two filed periods support it. */
  yoyPct: number | null;
  periodEnd: string | null;
  form: string | null;
  filed: string | null;
  periods: number | null;
  source: string | null;
  /** Lower is better for this line (a net LOSS growing is not good news). */
  invertTone?: boolean;
  /**
   * This figure's period is behind the company's latest reported period, so it
   * must not be read alongside the current ones.
   */
  stale?: boolean;
};

export type Financials = {
  /**
   * Whether the SEC resolver actually RAN for this company.
   *
   * False means unknown, not "private". The page may only state that a
   * company does not file once this is true — otherwise an aborted request
   * reads as a finding, which is how Cloudflare came to be described as not a
   * public filer.
   */
  checked: boolean;
  /** The resolver ran and found no annual report naming this domain. */
  notAFiler: boolean;
  /** Null when the company is not a filer, which is the normal case. */
  cik: string | null;
  registrant: string | null;
  /** Several filers mention the domain and none could be identified. */
  unresolvedCandidates: string | null;
  figures: FiledFigure[];
  /** The most recent period any figure covers. The reference for staleness. */
  latestPeriod: string | null;
  /** At least one figure is from an earlier period than the latest. */
  mixedPeriods: boolean;
  /** The newest filing date across every figure — "last verified", honestly. */
  lastFiled: string | null;
  filingsMatched: number | null;
};

/**
 * Financial facts, shaped for display.
 *
 * The only reason this is a view model rather than a table dump: a reader
 * needs to know that every number here is a FILED number, and that the
 * absence of numbers means "not a public filer" rather than "we could not
 * find out". Those two are opposite claims and a bare empty table says the
 * wrong one.
 *
 * There is deliberately no revenue estimate, no valuation and no funding
 * total. Funding is not revenue, and an estimate is not a filing.
 */
export function financialsOf(f: FactMap): Financials {
  /*
   * Revenue is whichever TAG reports the later period.
   *
   * A filer may switch XBRL tags mid-life and the abandoned tag keeps
   * answering with its last good year forever. NVIDIA's ASC 606 tag stops at
   * FY2022 while `Revenues` runs to FY2026, so taking the first available tag
   * froze revenue four years behind net income.
   */
  const revenuePath = (() => {
    const candidates = ["financial.revenue", "financial.revenue_alt"].filter((pth) => num(f, pth) !== null);
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) =>
      (str(f, `${b}.period_end`) ?? "").localeCompare(str(f, `${a}.period_end`) ?? ""),
    )[0];
  })();

  const LINES: { path: string; label: string; invertTone?: boolean }[] = [
    ...(revenuePath ? [{ path: revenuePath, label: "Revenue" }] : []),
    { path: "financial.net_income", label: "Net income" },
    { path: "financial.cash", label: "Cash and equivalents" },
    { path: "financial.assets", label: "Total assets" },
    { path: "financial.equity", label: "Shareholders' equity" },
  ];

  const figures: FiledFigure[] = [];
  for (const line of LINES) {
    const value = num(f, line.path);
    if (value === null) continue;
    figures.push({
      path: line.path,
      label: line.label,
      value,
      unit: str(f, `${line.path}.unit`) ?? "USD",
      yoyPct: num(f, `${line.path}.yoy_pct`),
      periodEnd: str(f, `${line.path}.period_end`),
      form: str(f, `${line.path}.form`),
      filed: str(f, `${line.path}.filed`),
      periods: num(f, `${line.path}.periods_available`),
      source: src(f, line.path),
      invertTone: line.invertTone,
    });
  }

  const filedDates = figures.map((x) => x.filed).filter((d): d is string => !!d);

  /*
   * Period coherence.
   *
   * Figures from different years must never be read as one set. Side by side
   * and unlabelled, a 2022 revenue next to a 2026 net income implies a margin
   * that does not exist — a fabricated fact assembled from two true ones.
   *
   * So the latest period is the reference, anything behind it is marked, and
   * the UI separates them. The figure is still shown, because an older filed
   * number is real; what it must not do is pose as current.
   */
  const periods = figures.map((x) => x.periodEnd).filter((d): d is string => !!d);
  const latestPeriod = periods.length ? periods.slice().sort().at(-1)! : null;
  for (const x of figures) {
    x.stale = !!latestPeriod && !!x.periodEnd && x.periodEnd < latestPeriod;
  }

  const filer = str(f, "corporate.sec.filer");

  return {
    checked: filer !== null,
    notAFiler: filer === "false",
    cik: str(f, "corporate.sec.cik"),
    registrant: str(f, "corporate.sec.registrant"),
    unresolvedCandidates: str(f, "corporate.sec.candidates"),
    figures,
    latestPeriod,
    mixedPeriods: figures.some((x) => x.stale),
    lastFiled: filedDates.length ? filedDates.sort().at(-1)! : null,
    filingsMatched: num(f, "corporate.sec.filings_matched"),
  };
}

/**
 * Large money, at the scale a reader can hold in their head.
 *
 * Distinct from the `money` helper above, which converts MINOR units for
 * pricing. A filing reports whole units, and a revenue line is nine digits —
 * running it through the pricing formatter would divide it by a hundred.
 *
 * Exact to the dollar is what the fact table is for; a headline needs
 * "$2.17B". Negatives are parenthesised the way a filing prints them, because
 * a minus sign in front of a large number is easy to miss and the difference
 * between a profit and a loss is the whole point of the line.
 */
export function bigMoney(value: number, unit = "USD"): string {
  const sign = value < 0;
  const n = Math.abs(value);
  const [div, suffix] =
    n >= 1e12 ? [1e12, "T"] : n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  const scaled = n / div;
  const body = `${scaled.toFixed(scaled >= 100 || suffix === "" ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
  const prefix = unit === "USD" ? "$" : `${unit} `;
  return sign ? `(${prefix}${body})` : `${prefix}${body}`;
}

// ---------------------------------------------------------------------------
// Security exposure
// ---------------------------------------------------------------------------

export type SecurityPosture = {
  /** What the advisories are about — a package they publish. */
  subject: string | null;
  count: number | null;
  bySeverity: { severity: string; count: number }[];
  worst: string | null;
  maxCvss: number | null;
  latest: string | null;
  cves: string[];
  /** Advisories the company published itself, for its own repository. */
  disclosed: number | null;
  disclosedSubject: string | null;
  disclosedLatest: string | null;
  /** OpenSSF Scorecard, already collected elsewhere in the catalog. */
  scorecard: number | null;
  dmarcPolicy: string | null;
};

/**
 * Security posture, assembled so it cannot be read as a verdict.
 *
 * An advisory count is not a safety score, and the naive reading of it is
 * backwards: a company that publishes advisories for its own code is running
 * a disclosure process, which is what good looks like. So disclosures are
 * kept separate from advisory counts and never summed — the same CVE appears
 * in both feeds.
 */
export function securityOf(f: FactMap): SecurityPosture {
  const bySeverity = (["critical", "high", "medium", "low"] as const)
    .map((s) => ({ severity: s, count: num(f, `security.advisories.${s}`) ?? 0 }))
    .filter((x) => x.count > 0);

  return {
    subject: str(f, "security.advisories.subject"),
    count: num(f, "security.advisories.count"),
    bySeverity,
    worst: str(f, "security.advisories.worst_severity"),
    maxCvss: num(f, "security.advisories.max_cvss"),
    latest: str(f, "security.advisories.latest"),
    cves: list(f, "security.advisories.cves"),
    disclosed: num(f, "security.disclosures.count"),
    disclosedSubject: str(f, "security.disclosures.subject"),
    disclosedLatest: str(f, "security.disclosures.latest"),
    scorecard: num(f, "security.scorecard.score"),
    dmarcPolicy: str(f, "security.dmarc_policy"),
  };
}

/** Anything worth drawing a section for. */
export const hasSecurity = (s: SecurityPosture): boolean =>
  s.count !== null || s.disclosed !== null || s.scorecard !== null;
