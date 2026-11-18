/**
 * Typed, scored signals about a prospect.
 *
 * The old pipeline handed the model the first 14 sentences in DOM order —
 * which on nearly every site is the hero banner, the single most generic text
 * a company owns. Then we asked it to be specific. No prompt fixes that.
 *
 * So: gather signals of known KINDS, score them by how much a human would
 * actually react to being told about them, and send only the strongest. A
 * dated changelog entry or an open role beats a tagline every time, and the
 * reply-rate data says so too (trigger events ~11.4% vs name+company ~4.7%).
 */

import * as cheerio from "cheerio";

export type SignalType =
  | "recent"      // something dated and fresh — the strongest hook there is
  | "hiring"      // open roles: growth, and budget
  | "customer"    // a named customer or case study
  | "metric"      // contains a real figure
  | "product"     // pricing, changelog, how the thing actually works
  | "tech"        // detected stack
  | "positioning"; // hero / about copy — true, but says little

export type Signal = {
  text: string;
  type: SignalType;
  sourceUrl: string;
  score: number;
  /** ISO date when the signal carries one. Drives the recency bonus. */
  date?: string;
};

/** Base weights. `positioning` is deliberately far below everything else. */
const BASE: Record<SignalType, number> = {
  recent: 100,
  hiring: 90,
  customer: 80,
  metric: 70,
  product: 65,
  tech: 60,
  positioning: 30,
};

/** Pages worth reading, roughly in order of how much signal they carry. */
export const SIGNAL_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/company",
  "/careers",
  "/jobs",
  "/pricing",
  "/blog",
  "/news",
  "/customers",
  "/case-studies",
  "/changelog",
] as const;

/** What kind of page a path is, which seeds the signal type. */
export function pathKind(url: string): SignalType {
  const p = url.toLowerCase();
  if (/\/(careers|jobs)/.test(p)) return "hiring";
  if (/\/(customers|case-studies|case-study)/.test(p)) return "customer";
  if (/\/(blog|news|changelog|releases?)/.test(p)) return "recent";
  if (/\/pricing/.test(p)) return "product";
  return "positioning";
}

// --- Structured data --------------------------------------------------------

export type Structured = {
  description?: string;
  foundingDate?: string;
  employees?: string;
  /** Most recent date found anywhere on the page. */
  latestDate?: string;
  tech: string[];
};

/**
 * Fingerprints matched against the RAW html. The old extractor stripped
 * <script> before looking at anything, which made this impossible.
 */
const TECH: Array<[string, RegExp]> = [
  ["Shopify", /cdn\.shopify\.com|shopifycloud/i],
  ["HubSpot", /js\.hs-scripts\.com|hubspot/i],
  ["Webflow", /webflow\.(com|io)|generator"\s+content="Webflow/i],
  ["WordPress", /wp-content|wp-includes|content="WordPress/i],
  ["Intercom", /widget\.intercom\.io|intercomcdn/i],
  ["Segment", /cdn\.segment\.(com|io)/i],
  ["Klaviyo", /static\.klaviyo\.com/i],
  ["Stripe", /js\.stripe\.com/i],
  ["Next.js", /\/_next\/static/i],
  ["Framer", /framerusercontent\.com/i],
  ["Squarespace", /squarespace\.com|static1\.squarespace/i],
  ["Salesforce", /force\.com|salesforce\.com\/embeddedservice/i],
  ["Zendesk", /static\.zdassets\.com/i],
  ["Drift", /js\.driftt\.com/i],
  ["Marketo", /munchkin\.marketo\.net/i],
];

const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})\b/;

export function extractStructured(html: string, $?: cheerio.CheerioAPI): Structured {
  const out: Structured = { tech: [] };

  for (const [name, re] of TECH) if (re.test(html)) out.tech.push(name);

  const doc = $ ?? cheerio.load(html);

  out.description =
    doc('meta[name="description"]').attr("content")?.trim() ||
    doc('meta[property="og:description"]').attr("content")?.trim() ||
    undefined;

  const dates: string[] = [];

  // <time datetime="...">
  doc("time[datetime]").each((_, el) => {
    const d = doc(el).attr("datetime");
    const m = d?.match(ISO_DATE);
    if (m) dates.push(m[1]);
  });

  // JSON-LD: organization facts and publication dates.
  doc('script[type="application/ld+json"]').each((_, el) => {
    const raw = doc(el).contents().text();
    if (!raw) return;
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        const o = node as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
        if (!out.foundingDate) out.foundingDate = str(o.foundingDate);
        if (!out.employees && o.numberOfEmployees) {
          const n = o.numberOfEmployees as Record<string, unknown>;
          out.employees = str(o.numberOfEmployees) ?? str(n?.value) ?? undefined;
        }
        for (const k of ["datePublished", "dateModified", "uploadDate"]) {
          const m = str(o[k])?.match(ISO_DATE);
          if (m) dates.push(m[1]);
        }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD is extremely common; it is never worth failing over.
    }
  });

  // Visible ISO dates, then long-form prose dates ("November 5, 2026"),
  // which is how most blogs and changelogs actually print them.
  const visible = html.match(new RegExp(ISO_DATE, "g"));
  if (visible) dates.push(...visible);

  const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
  for (const m of html.matchAll(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "gi"))) {
    const month = String(new Date(`${m[1]} 1, 2000`).getMonth() + 1).padStart(2, "0");
    dates.push(`${m[3]}-${month}-${m[2].padStart(2, "0")}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const usable = dates.filter((d) => d <= today).sort();
  out.latestDate = usable[usable.length - 1];

  return out;
}

// --- Scoring ----------------------------------------------------------------

const HAS_NUMBER = /\b\d[\d,.]*\s*(%|k\b|m\b|bn\b|million|billion|customers|users|countries|people|teams|years)?/i;
const PROPER_NOUN = /(?:^|[^.!?]\s)([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)/;
const CUSTOMER_HINT = /\b(customers?|clients?|trusted by|works? with|partners?|case stud)/i;
const HIRING_HINT = /\b(hiring|we're looking for|join (our|the) team|open roles?|apply now|position)/i;

function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Promote a sentence from its page's default kind when its CONTENT is
 * stronger than its location — a metric on the homepage still beats a
 * tagline on the about page.
 */
export function classify(text: string, fromPath: SignalType): SignalType {
  if (HIRING_HINT.test(text)) return "hiring";

  // A careers page is mostly culture copy. "Keep the team small" is a company
  // value, not a hiring trigger, and quoting it as one produces a strange
  // email. Only promote to `hiring` when the text actually says so (above);
  // otherwise judge it on content like any other sentence.
  const kind = fromPath === "hiring" ? "positioning" : fromPath;

  if (CUSTOMER_HINT.test(text)) return "customer";
  if (kind !== "positioning") return kind;
  if (/\d/.test(text) && HAS_NUMBER.test(text)) return "metric";
  return "positioning";
}

export function scoreSignal(s: Omit<Signal, "score">): number {
  let score = BASE[s.type];

  // FAQ headings ("What should I expect during the hiring process?") read as
  // signals but say nothing about this company. Push them to the bottom.
  if (s.text.trim().endsWith("?")) score -= 60;

  // Recency is the single most valuable property a signal can have.
  const age = daysSince(s.date);
  if (age !== undefined) {
    if (age <= 14) score += 40;
    else if (age <= 45) score += 25;
    else if (age <= 90) score += 12;
    else if (age > 540) score -= 20; // stale enough to be embarrassing
  }

  if (/\d/.test(s.text) && HAS_NUMBER.test(s.text)) score += 15;
  if (PROPER_NOUN.test(s.text)) score += 8;

  // A fact from a deep page took effort to find and reads that way.
  if (!/\/$/.test(s.sourceUrl) && !s.sourceUrl.endsWith(".com")) score += 6;

  // Long enough to say something, short enough to quote cleanly.
  const len = s.text.length;
  if (len >= 70 && len <= 180) score += 6;

  return score;
}

/**
 * Best signals first, with at most two of any one type so a careers page full
 * of job titles cannot crowd out everything else.
 */
export function rankSignals(signals: Signal[], limit = 8): Signal[] {
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const perType = new Map<SignalType, number>();
  const out: Signal[] = [];

  for (const s of sorted) {
    if (out.length >= limit) break;
    const n = perType.get(s.type) ?? 0;
    if (n >= 2) continue;
    perType.set(s.type, n + 1);
    out.push(s);
  }
  // Backfill if diversity capping left room.
  for (const s of sorted) {
    if (out.length >= limit) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function buildSignal(
  text: string,
  sourceUrl: string,
  fromPath: SignalType,
  date?: string,
): Signal {
  const type = classify(text, fromPath);
  const partial = { text, type, sourceUrl, date };
  return { ...partial, score: scoreSignal(partial) };
}
