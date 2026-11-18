/**
 * Server-side prospect research.
 *
 * Fetches a prospect's public pages and extracts candidate sentences that a
 * personalized opener could be grounded in. This runs on OUR server; the
 * user's API key never comes here.
 *
 * Rules we hold ourselves to:
 *  - robots.txt is respected. Always.
 *  - generic User-Agent; we never leak who the customer is to the prospect.
 *  - short timeouts, hard caps. A slow prospect site must not stall a run.
 */

import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import {
  SIGNAL_PATHS,
  pathKind,
  extractStructured,
  buildSignal,
  rankSignals,
  type Signal,
} from "./signals";

// ponytail: generic UA on purpose. Never identify the customer to the prospect.
const UA = "Mozilla/5.0 (compatible; LedeBot/1.0; +https://lede.sh/bot)";
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;

/** Pages we try, in order. First two or three that exist are enough. */
const CANDIDATE_PATHS = ["/", "/about", "/about-us", "/company"];

export type Sentence = {
  text: string;
  /** Page the sentence came from, so the receipt can cite it. */
  sourceUrl: string;
};

export type ResearchResult = {
  domain: string;
  /** Ranked, typed signals. This is what the row prompt actually uses. */
  signals: Signal[];
  /** Detected stack, meta description, dates. */
  structured?: { description?: string; tech: string[]; latestDate?: string; employees?: string };
  /** Page <title> of the homepage, useful context for the model. */
  title: string | null;
  sentences: Sentence[];
  /** Set when we deliberately did not fetch. The row becomes a skip. */
  blockedReason?: "robots" | "unreachable" | "no-content";
};

function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!trimmed || !trimmed.includes(".") || /\s/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;

    // Guard against multi-megabyte pages blowing up a batch run.
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) return null;
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

/**
 * Boilerplate that is technically on the page but says nothing about the
 * prospect. Grounding an opener in a cookie banner is worse than skipping.
 */
const BOILERPLATE = [
  // Anchored to banner phrasing. An unanchored /cookie/i silently
  // discarded real sentences from food and martech companies.
  /\b(this (site|website) uses|we use) cookies\b/i,
  /\bcookie (policy|settings|preferences|consent|banner)\b/i,
  /\baccept (all )?cookies\b/i,
  /privacy polic/i,
  /terms of (service|use)/i,
  /all rights reserved/i,
  /©|\(c\)\s*20\d\d/,
  /subscribe to our newsletter/i,
  /sign up for/i,
  /JavaScript (is )?(required|disabled)/i,
  /enable JavaScript/i,
  /skip to (main )?content/i,
  /^(home|about|contact|blog|pricing|login|menu)$/i,
];

function looksLikeBoilerplate(s: string): boolean {
  return BOILERPLATE.some((re) => re.test(s));
}

/**
 * Text of one element, with a space wherever an element boundary sits.
 * `$el.text()` glues inline children together ("with lessWe build"), which
 * then gets quoted verbatim into a customer's email.
 */
type DomNode = { type: string; data?: string };

function inlineText($: cheerio.CheerioAPI, el: DomNode): string {
  const parts: string[] = [];
  const walk = (node: DomNode) => {
    if (node.type === "text") {
      parts.push(node.data ?? "");
return;
    }
    if (node.type === "tag") {
      parts.push(" ");
      $(node as never).contents().each((_, c) => walk(c as DomNode));
      parts.push(" ");
    }
  };
  $(el as never).contents().each((_, c) => walk(c as DomNode));
  return parts.join("");
}

/** Block-level elements whose text we read one at a time. */
const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, td, blockquote, figcaption, dd, dt, summary";

/**
 * A word boundary lost between two elements produces "billionth.Fina" — which
 * would then be quoted verbatim into a customer's email. So we never take
 * .text() over a whole subtree; we read block elements individually.
 */
export function extractSentences(html: string, sourceUrl: string): Sentence[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, svg, form, iframe, aside, template").remove();

  const root = $("main").length ? $("main") : $("body");

  const seen = new Set<string>();
  const out: Sentence[] = [];

  root.find(BLOCKS).each((_, el) => {
    const $el = $(el);
    // Skip a block that merely wraps other blocks — its children are handled.
    if ($el.find(BLOCKS).length > 0) return;

    const blockText = inlineText($, el as unknown as DomNode)
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      // List markers ("08.", "1)") are layout, not part of the sentence.
      .replace(/^\d{1,2}[.)]\s*/, "")
      .trim();
    if (!blockText) return;

    // Nav and card grids concatenate into run-ons like
    // "Analytics EngineerNorth AmericaLearn more→". A brand name such as
    // PostHog or iPhone produces at most one lowercase→uppercase join, so
    // count the transitions rather than trying to exempt brands by pattern —
    // the old exemption regex deleted the evidence the test was looking for.
    const joins = blockText.match(/[a-z][A-Z]/g)?.length ?? 0;
    if (joins >= 2) return;
    if (/(learn more|read more|view all|see all)\s*[→>»]/i.test(blockText)) return;

    for (const part of blockText.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)) {
      const text = part.trim();
      if (text.length < 45 || text.length > 240) continue;
      if (looksLikeBoilerplate(text)) continue;
      if ((text.match(/\s/g)?.length ?? 0) < 6) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, sourceUrl });
    }
  });

  return out;
}

export function extractTitle(html: string): string | null {
  const $ = cheerio.load(html);
  const t = $("title").first().text().replace(/\s+/g, " ").trim();
  return t || null;
}

/**
 * Research one prospect domain. Returns at most `maxSentences` candidates.
 *
 * Never throws — a failed prospect is a skipped row, not a failed run.
 */
export async function research(
  rawDomain: string,
  maxSignals = 8,
): Promise<ResearchResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return { domain: rawDomain, title: null, sentences: [], signals: [], blockedReason: "unreachable" };
  }

  const origin = `https://${domain}`;

  // robots.txt first. If it says no, we stop.
  let robots: ReturnType<typeof robotsParser> | null = null;
  const robotsTxt = await fetchText(`${origin}/robots.txt`);
  if (robotsTxt) robots = robotsParser(`${origin}/robots.txt`, robotsTxt);

  const allowed = SIGNAL_PATHS.filter(
    (path) => !(robots && robots.isDisallowed(`${origin}${path}`, "LedeBot") === true),
  );

  // Fetch every candidate CONCURRENTLY and gather everything before ranking.
  // The old loop stopped at 14 sentences, so deeper pages were never reached
  // and the model only ever saw homepage hero copy.
  const pages = await Promise.all(
    allowed.map(async (path) => ({ path, html: await fetchText(`${origin}${path}`) })),
  );

  const fetched = pages.filter((p) => p.html);
  if (fetched.length === 0) {
    return {
      domain,
      title: null,
      sentences: [],
      signals: [],
      blockedReason: robots ? "robots" : "unreachable",
    };
  }

  let title: string | null = null;
  const seenText = new Set<string>();
  const sentences: Sentence[] = [];
  const signals: Signal[] = [];
  const tech = new Set<string>();
  const roles = new Set<string>();
  let description: string | undefined;
  let latestDate: string | undefined;
  let employees: string | undefined;

  for (const { path, html } of fetched) {
    if (!html) continue;
    const url = `${origin}${path}`;

    // Structured data must be read from the RAW html, before the strip.
    const structured = extractStructured(html);
    structured.tech.forEach((t) => tech.add(t));
    if (!description) description = structured.description;
    if (!employees) employees = structured.employees;
    if (structured.latestDate && (!latestDate || structured.latestDate > latestDate)) {
      latestDate = structured.latestDate;
    }

    if (path === "/") title = extractTitle(html);

    const kind = pathKind(url);
    if (kind === "hiring") for (const r of extractRoles(html)) roles.add(r);
    for (const s of extractSentences(html, url)) {
      const key = s.text.toLowerCase().replace(/\s+/g, " ").trim();
      if (seenText.has(key)) continue; // /about and /about-us often duplicate
      seenText.add(key);
      sentences.push(s);
      signals.push(buildSignal(s.text, url, kind, structured.latestDate));
    }
  }

  if (roles.size) {
    const list = [...roles].slice(0, 6).join(", ");
    signals.push(
      buildSignal(`They are currently hiring for: ${list}.`, `${origin}/careers`, "hiring", latestDate),
    );
  }

  // The stack is itself a signal — strong for anyone selling into it.
  if (tech.size) {
    signals.push(buildSignal(`They run ${[...tech].join(", ")} on their site.`, origin, "tech"));
  }
  if (description && description.length > 40) {
    signals.push(buildSignal(description, origin, "positioning"));
  }

  if (signals.length === 0) {
    return { domain, title, sentences: [], signals: [], blockedReason: "no-content" };
  }

  return {
    domain,
    title,
    sentences,
    signals: rankSignals(signals, maxSignals),
    structured: { description, tech: [...tech], latestDate, employees },
  };
}

/** Job titles from a careers page: short, title-cased, role-shaped. */
const ROLE_WORD =
  /\b(engineer|designer|manager|director|lead|analyst|scientist|developer|architect|recruiter|marketer|producer|counsel|controller|specialist|representative|executive|officer|head of|vp of|intern)\b/i;

export function extractRoles(html: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("a, h2, h3, h4, li").each((_, el) => {
    if (out.size >= 12) return;
    const t = $(el)
      .text()
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      // Job cards trail a CTA: "Account Executive, Growth SingaporeLearn more→"
      .replace(/\s*(learn more|read more|apply( now)?|view (job|role))\s*[→>»]?\s*$/i, "")
      .replace(/[→>»]\s*$/, "")
      .trim();
    // Real titles are short. Anything long is a paragraph that mentions a role.
    if (t.length < 4 || t.length > 48) return;
    if (!ROLE_WORD.test(t)) return;
    if (/\b(we|our|you|your|the team|about|apply|learn more)\b/i.test(t)) return;
    // "Developer blog", "hiring process", "Engineering guide" are nav links
    // that happen to contain a role word.
    if (/\b(blog|process|guide|faq|docs?|news|story|stories|podcast|handbook|culture)\b/i.test(t)) return;
    if (t.endsWith("?")) return;
    out.add(t);
  });
  return [...out];
}
