/**
 * Structured pricing extraction — tier names, monthly AND annual prices, seat
 * basis, product lines, custom tiers.
 *
 * This is the hardest extraction in the product and the one a buyer judges us
 * on, because a wrong price is worse than no price. It is therefore a CASCADE
 * ordered by precision, not a single clever parser, and the layer that answered
 * is recorded as a fact so a buyer can see whether a number was read from
 * structured data or inferred from prose.
 *
 *   1. JSON-LD   schema.org Offer + UnitPriceSpecification. Exact. A W3C
 *                standard, so it generalises beyond the sites we tested.
 *   2. FRAMEWORK Next.js RSC / __NEXT_DATA__ payloads that carry parallel
 *                plan-name and plan-price maps.
 *   3. TEXT      window scanning. Works where there is no structured data at
 *                all (slack, linear), and is where all the guards live.
 *   4. LLM       not implemented here. Budget-queued, quote-verified via
 *                lib/grounding.ts, and only ever reached when 1-3 find nothing.
 *
 * Every guard below exists because a real page broke an earlier version:
 *   - monday    "Total of $120", "$12 x 10 seats", struck-through "$140",
 *               "Special offer: $10 off"  -> none of those is a plan price.
 *   - monday    FOUR product ladders on one page (Work Management, CRM, Dev,
 *               Service) with different prices for the same tier names.
 *   - notion    "Basic forms", "Custom sites", and an $8 Notion AI ADD-ON that
 *               was being reported as a tier.
 *   - vercel    a $0.08 metered usage rate reported as a tier.
 *   - slack     returned Rupees, because pricing pages localise to the CALLER.
 *
 * CURRENCY CAVEAT, and it is real: fetching slack.com/pricing from India
 * returned "₹0", not "$0". What we record is "the currency our crawler was
 * shown", never "the company's currency". Comparison must normalise via FX and
 * the UI must name the observed currency.
 */

import { collect, jsonLdBlocks, type LdNode } from "./jsonld";
import { decodeEntities, quote, type Fact } from "./types";

export type Money = { amountMinor: number; currency: string };

export type Tier = {
  /** As printed. */
  name: string;
  /** Stable key for fact paths. */
  slug: string;
  /** Set when one page sells several ladders (monday has four). */
  productLine: string | null;
  /** Price when billed monthly. */
  monthly: Money | null;
  /** Price under annual billing. See annualBasis for what the number means. */
  annual: Money | null;
  /**
   * Whether `annual` is a per-month rate under an annual commitment
   * ("$9/seat/month, billed annually") or a true yearly figure ("$108/year").
   * Conflating these was a real bug, so it is an explicit field.
   */
  annualBasis: "per-month" | "per-year" | null;
  perSeat: boolean;
  seatUnit: string | null;
  isFree: boolean;
  /** A real tier with no public price — "Contact sales". */
  isCustom: boolean;
  /** Several seat classes priced within one tier, e.g. figma full vs dev seat. */
  seatClasses?: string[];
  order: number;
  confidence: number;
  quote: string;
  /** Internal: did the page show explicit period/seat text? Stripped on return. */
  _grounded?: boolean;
  /** Internal: text-node index, used for positional clustering. Stripped. */
  _at?: number;
};

export type PricingSource = "json-ld" | "framework" | "text" | "visual" | "none";

export type PricingShape = {
  tiers: Tier[];
  productLines: string[];
  /** The currency our crawler was shown. See the caveat above. */
  currencyObserved: string | null;
  source: PricingSource;
  notes: string[];
};

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const TIER_WORDS = [
  "free", "freemium", "starter", "basic", "essentials", "essential", "standard",
  "plus", "pro", "professional", "premium", "team", "teams", "business",
  "growth", "scale", "enterprise", "agency", "advanced", "ultimate", "hobby",
  "personal", "individual", "solo", "studio", "organization", "organisation",
  "unlimited", "custom", "startup",
];
const TIER_RE = new RegExp(`^(${TIER_WORDS.join("|")})(\\s*\\+|\\s+plan|\\s*\\(.*\\))?$`, "i");

const SYMBOL: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", AUD: "A$", CAD: "C$", BRL: "R$",
};
const toSymbol = (c: string | null | undefined): string =>
  !c ? "$" : SYMBOL[c.toUpperCase()] ?? c;

const minor = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export const slugify = (s: string) =>
  s.toLowerCase().replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);

/**
 * Decide what an annual figure means.
 *
 * monday publishes unitCode="ANN" with price 9 while the page reads
 * "$9 seat/month, Billed annually" — so ANN marks the annual PLAN, not a yearly
 * amount. Nobody charges less per year than per month, so a lower annual number
 * is necessarily a monthly-equivalent rate.
 */
function resolveAnnualBasis(monthlyMinor: number | null, annualMinor: number | null, hint?: string | null): Tier["annualBasis"] {
  if (annualMinor === null) return null;
  if (hint && /billed\s+(annually|yearly)/i.test(hint)) return "per-month";
  if (hint && /per\s+year|\/\s*year|annually\b(?!.*billed)/i.test(hint) && monthlyMinor === null) return "per-year";
  if (monthlyMinor !== null) return annualMinor < monthlyMinor ? "per-month" : "per-year";
  return "per-month";
}

/**
 * ONE comparable number per tier, in minor units per seat per month.
 *
 * Pages state the same deal in incompatible ways — linear prints "$10 per
 * user/month, billed yearly" while others print "$120/year". Comparison pages
 * and /compare/a-vs-b need a single canonical figure, so derive it rather than
 * forcing every page into one shape.
 */
export function monthlyEquivalentMinor(t: Tier): number | null {
  if (t.monthly) return t.monthly.amountMinor;
  if (!t.annual) return null;
  return t.annualBasis === "per-year" ? Math.round(t.annual.amountMinor / 12) : t.annual.amountMinor;
}

/**
 * Annual discounts cluster between roughly 10% and 30%. Much more than that
 * usually means two unrelated numbers were paired — slack's page produced a 55%
 * "discount" that way. Flag it rather than publishing it confidently.
 */
export const IMPLAUSIBLE_DISCOUNT_PCT = 40;

const isContactSales = (s: string | null | undefined) =>
  Boolean(s && /\b(contact (sales|us)|talk to (sales|us)|custom pricing|get a quote|request a (quote|demo)|let'?s talk)\b/i.test(s));

// ---------------------------------------------------------------------------
// Layer 1 — JSON-LD. Exact, and a standard.
// ---------------------------------------------------------------------------

function tierFromOffer(offer: LdNode, line: string | null, order: number): Tier | null {
  const name = typeof offer.name === "string" ? offer.name.trim() : "";
  if (!name || name.length > 40) return null;

  const desc = typeof offer.description === "string" ? offer.description : null;
  let monthly: Money | null = null;
  let annual: Money | null = null;
  let perSeat = false;
  let seatUnit: string | null = null;
  let hint = desc;

  const specs = collect(offer.priceSpecification, ["UnitPriceSpecification", "PriceSpecification"]);
  for (const spec of specs) {
    const amt = minor(spec.price);
    if (amt === null) continue;
    const cur = toSymbol(typeof spec.priceCurrency === "string" ? spec.priceCurrency : null);
    const code = String(spec.unitCode ?? "").toUpperCase();
    const sdesc = typeof spec.description === "string" ? spec.description : "";
    if (sdesc) hint = `${hint ?? ""} ${sdesc}`.trim();
    if (/per seat|per user|per member|per editor/i.test(sdesc)) {
      perSeat = true;
      seatUnit = sdesc.match(/per (seat|user|member|editor)/i)?.[1].toLowerCase() ?? seatUnit;
    }
    // UN/CEFACT: MON/MTH = month, ANN = annual billing.
    const yearly = code.startsWith("ANN") || /annual|year/i.test(sdesc);
    if (yearly && annual === null) annual = { amountMinor: amt, currency: cur };
    else if (!yearly && monthly === null) monthly = { amountMinor: amt, currency: cur };
  }

  // A flat `price` with no spec array — typically the free tier.
  if (!specs.length) {
    const amt = minor(offer.price);
    if (amt !== null) {
      monthly = { amountMinor: amt, currency: toSymbol(typeof offer.priceCurrency === "string" ? offer.priceCurrency : null) };
    }
  }

  const custom = monthly === null && annual === null && isContactSales(desc);
  if (monthly === null && annual === null && !custom) return null;

  return {
    name, slug: slugify(name), productLine: line,
    monthly, annual,
    annualBasis: resolveAnnualBasis(monthly?.amountMinor ?? null, annual?.amountMinor ?? null, hint),
    perSeat, seatUnit,
    isFree: monthly?.amountMinor === 0 || annual?.amountMinor === 0,
    isCustom: custom,
    order, confidence: 1,
    quote: quote(desc ?? `${name}: ${monthly ? monthly.currency + monthly.amountMinor / 100 : "custom"}`),
  };
}

export function fromJsonLd(html: string): PricingShape | null {
  const tiers: Tier[] = [];
  const lines: string[] = [];

  for (const block of jsonLdBlocks(html)) {
    for (const prod of collect(block, ["Product", "Service", "SoftwareApplication"])) {
      const offers = collect(prod.offers, ["Offer", "AggregateOffer"]);
      if (!offers.length) continue;
      const line = typeof prod.name === "string" ? prod.name.trim() : null;
      const before = tiers.length;
      for (const off of offers) {
        const t = tierFromOffer(off, line, tiers.length);
        if (t) tiers.push(t);
      }
      if (line && tiers.length > before && !lines.includes(line)) lines.push(line);
    }
  }

  if (tiers.length < 2) return null; // one tier is not a ladder; fall through
  const currencies = new Set(tiers.flatMap((t) => [t.monthly?.currency, t.annual?.currency]).filter(Boolean) as string[]);
  return {
    tiers, productLines: lines,
    currencyObserved: [...currencies][0] ?? null,
    source: "json-ld",
    notes: lines.length > 1 ? [`${lines.length} product lines on one page`] : [],
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — framework payloads.
//
// ponytail: deliberately narrow. It reads the PARALLEL-MAP shape only
// (`planNames` + `planPrices` keyed by the same slugs), which is what Next.js
// marketing pages emit and what vercel.com uses. Anything more general is the
// LLM layer's job — a half-general JSON crawler would invent tiers, and a wrong
// price is worse than no price.
// ---------------------------------------------------------------------------

export function fromFramework(html: string): PricingShape | null {
  // RSC payloads are embedded as escaped JSON strings; \" and $$ both appear.
  const unescaped = html.replace(/\\"/g, '"').replace(/\$\$/g, "$");

  const names = [...unescaped.matchAll(/"plan(?:Names|Titles)"\s*:\s*(\{[^{}]{0,2000}?\})/g)];
  const prices = [...unescaped.matchAll(/"plan(?:Prices|Pricing)"\s*:\s*(\{[\s\S]{0,4000}?\}\s*\})/g)];
  if (!names.length || !prices.length) return null;

  let nameMap: Record<string, string>;
  let priceMap: Record<string, { amount?: string; suffix?: string }>;
  try {
    nameMap = JSON.parse(names[0][1]) as Record<string, string>;
    priceMap = JSON.parse(prices[0][1]) as Record<string, { amount?: string; suffix?: string }>;
  } catch { return null; }

  const tiers: Tier[] = [];
  for (const [key, label] of Object.entries(nameMap)) {
    if (typeof label !== "string") continue;
    const p = priceMap[key];
    if (!p) continue;
    const raw = String(p.amount ?? "");
    const custom = /custom|contact/i.test(raw);
    const amt = custom ? null : minor(raw);
    if (amt === null && !custom) continue;

    const cur = raw.match(/[$€£₹¥]/)?.[0] ?? "$";
    const yearly = /\/\s*(yr|year)/i.test(String(p.suffix ?? ""));
    const money = amt === null ? null : { amountMinor: amt, currency: cur };

    tiers.push({
      name: label.trim(), slug: slugify(label), productLine: null,
      monthly: yearly ? null : money,
      annual: yearly ? money : null,
      annualBasis: yearly ? "per-year" : null,
      perSeat: /per (user|seat|member)/i.test(String(p.suffix ?? "")),
      seatUnit: String(p.suffix ?? "").match(/per (user|seat|member)/i)?.[1].toLowerCase() ?? null,
      isFree: amt === 0,
      isCustom: custom,
      order: tiers.length, confidence: 0.9,
      quote: quote(`${label}: ${raw}${p.suffix ?? ""}`),
    });
  }

  if (tiers.length < 2) return null;
  const currencies = new Set(tiers.flatMap((t) => [t.monthly?.currency, t.annual?.currency]).filter(Boolean) as string[]);
  return { tiers, productLines: [], currencyObserved: [...currencies][0] ?? null, source: "framework", notes: [] };
}

// ---------------------------------------------------------------------------
// Layer 3 — text windows. Where the guards live.
// ---------------------------------------------------------------------------

/**
 * Navigation vocabulary. MUST stay global: `String.match` with a NON-global
 * regex returns [match, ...captures], so a `.length >= 2` test fired on a
 * SINGLE nav word and silently rejected real tiers — notion's Free tier says
 * "Sign up" and was being dropped for it.
 */
const NAV_WORDS = /\b(log ?in|sign ?up|sign ?in|resources|solutions|templates|customer stories|webinars|blog|events|discover|what'?s new|documentation|careers|partners|skip to)\b/gi;
/** A tier word with a feature tail is a feature: "Basic forms", "Custom sites". */
const FEATURE_TAIL = /\b(forms?|sites?|connections?|search|analytics|reporting|support|roles?|permissions?|sso|api|integrations?|automations?|dashboards?|includes?|features?|credits?|add-?ons?|templates?|blocks?|charts?)\b/i;
/**
 * Add-ons are priced like tiers but are not tiers.
 *
 * Deliberately NARROW. An earlier version matched "ai credits?", which killed
 * every figma tier because figma lists "+ 3,000 AI credits/mo" as a tier
 * BENEFIT. Only language that marks a separate purchase belongs here.
 */
const ADDON = /\b(add-?on|credit pack|per credit|billed separately|sold separately)\b/i;
/** Metered usage, not a plan: "$0.08 per GB", "per 1,000 requests". */
const USAGE_UNIT = /\bper\s+(gb|tb|mb|request|call|token|minute|hour|invocation|build|execution|1,?000|million|unit|event|row|record)\b/i;

function textNodes(html: string): string[] {
  // NOTE: `<template>` is NOT stripped. Declarative shadow DOM is real visible
  // content — linear.app renders its entire tier ladder inside templates, and
  // removing them cost us the Business and Enterprise tiers.
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split(/<[^>]+>/)
    .map((s) => decodeEntities(s).replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0 && s.length < 200);
}

type RawPrice = { minorAmount: number; currency: string; at: number };

/** Every plausible plan price in a window, in order, with the junk removed. */
function pricesIn(win: string): RawPrice[] {
  // Re-assemble prices split across DOM nodes. linear.app emits "$16" as three
  // text nodes ("$", "1", "6"), which joined to "$ 1 6" and matched as "$1" —
  // a wrong price, which is worse than no price.
  const joined = win
    .replace(/([$€£₹¥₩₽])((?:\s*\d){1,7})(?=\s*(?:[.,]\s*\d\d)?(?:\s|$|\/|per\b))/gi,
             (_m, sym: string, digits: string) => sym + digits.replace(/\s+/g, ""))
    .replace(/([$€£₹¥₩₽])\s+(?=\d)/g, "$1");
  const out: RawPrice[] = [];
  for (const m of joined.matchAll(/([$€£₹¥₩₽])\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) {
    const before = joined.slice(Math.max(0, m.index - 46), m.index);
    const after = joined.slice(m.index + m[0].length, m.index + m[0].length + 30);

    // "Total of $120", "$12 x 10 seats", "was $140", "Save $20".
    if (/\b(total|totals?\s+of|save|saving|was|instead of|rrp|value|worth)\b[^.]{0,22}$/i.test(before)) continue;
    // "$10 off", "x 10 seats = $120".
    if (/^\s*(off\b|discount|credit)/i.test(after)) continue;
    if (/\bx\s*\d+\s*(seats?|users?)\s*=\s*$/i.test(before)) continue;
    // Metered usage rates are not plan prices.
    if (USAGE_UNIT.test(after)) continue;

    const n = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n) || n > 100_000) continue;
    // A sub-unit amount is a usage rate, not a plan: vercel's $0.08.
    if (n > 0 && n < 1) continue;
    out.push({ minorAmount: Math.round(n * 100), currency: m[1], at: m.index });
  }
  return out;
}

/**
 * Some ladders price several SEAT CLASSES per tier — figma sells
 * "Full seat $16 /mo" alongside "Dev seat $12 /mo". Record the classes so the
 * cheapest-seat figure is not mistaken for the headline price.
 */
function seatClasses(win: string): string[] {
  return [...new Set(
    [...win.matchAll(/\b(full|dev|developer|view(?:er)?|edit(?:or)?|collaborator|guest|admin)\s+seats?\b/gi)]
      .map((m) => m[1].toLowerCase()),
  )];
}

function seatBasis(win: string): { perSeat: boolean; seatUnit: string | null } {
  const m =
    win.match(/\bper\s+(user|member|seat|editor|person|host|agent)\b/i) ??
    win.match(/\b(user|member|seat|editor)\s*\/\s*(?:month|mo|year|yr)\b/i) ??
    // monday renders "9 | seat / | month" with no "per".
    win.match(/\b(seat|user|member|editor)\b(?=\s*\/?\s*(?:month|mo|year|yr)\b)/i) ??
    // figma: "Full seat $16 /mo" has no "per", but it is plainly per-seat.
    win.match(/\b(?:full|dev|developer|view|viewer|edit|editor|collaborator)\s+(seat)s?\b/i);
  return { perSeat: Boolean(m), seatUnit: m ? m[1].toLowerCase() : null };
}

export function fromText(html: string): PricingShape {
  const notesFromFilter: string[] = [];
  const nodes = textNodes(html);
  const found: Tier[] = [];
  const WINDOW = 10;

  for (let i = 0; i < nodes.length; i++) {
    const label = nodes[i];
    if (label.length > 30 || !TIER_RE.test(label)) continue;
    if (FEATURE_TAIL.test(label)) continue;
    // "Standard AI", "Basic AI" are add-ons sold beside the tier of that name.
    if (/\bAI\b/.test(label)) continue;

    const win = nodes.slice(i + 1, i + 1 + WINDOW).join(" ");
    // Count DISTINCT nav hits; a single "Sign up" inside a plan card is normal.
    const navHits = new Set((win.match(NAV_WORDS) ?? []).map((x) => x.toLowerCase())).size;
    if (navHits >= 3) continue;
    if (ADDON.test(win.slice(0, 120))) continue;

    const prices = pricesIn(win);
    const custom = isContactSales(win);
    if (!prices.length && !custom) continue;

    const { perSeat, seatUnit } = seatBasis(win);
    const classes = seatClasses(win);
    const billed = win.match(/\bbilled\s+(yearly|annually|monthly|quarterly)\b/i)?.[0] ?? null;
    const saysYear = /\b(per\s+year|\/\s*(year|yr)\b|annually|yearly|a year)\b/i.test(win);
    const hasPeriodText = /\b(per\s+(month|year)|\/\s*(mo|month|yr|year)\b|monthly|annually|yearly)\b/i.test(win);

    // Two prices side by side is the list/discounted pair: "$25 $17 seat/month".
    let monthly: Money | null = null;
    let annual: Money | null = null;
    // figma prints "Full seat $16 /mo + ... Dev seat $12 /mo": the second price
    // is a DIFFERENT SEAT CLASS, not an annual rate. Pairing them produced a
    // fake 25% "annual discount", so when several classes are named we take the
    // headline price only and record the classes separately.
    if (classes.length >= 2) {
      monthly = { amountMinor: prices[0].minorAmount, currency: prices[0].currency };
    } else if (prices.length >= 2 && prices[1].minorAmount < prices[0].minorAmount && prices[1].at - prices[0].at < 40) {
      monthly = { amountMinor: prices[0].minorAmount, currency: prices[0].currency };
      annual = { amountMinor: prices[1].minorAmount, currency: prices[1].currency };
    } else if (prices.length) {
      const money = { amountMinor: prices[0].minorAmount, currency: prices[0].currency };
      // "billed annually" means the PRINTED price is the annual-plan rate.
      if (billed && /annual|year/i.test(billed)) annual = money;
      else if (saysYear && !billed) annual = money;
      else monthly = money;
    }

    let confidence = 0.5;
    if (prices.length) confidence += 0.25;
    if (monthly || annual) confidence += 0.1;
    if (perSeat || billed) confidence += 0.1;
    if (!prices.length && custom) confidence = 0.6;

    found.push({
      name: label.replace(/\s+plan$/i, "").trim(),
      slug: slugify(label),
      productLine: null,
      monthly, annual,
      annualBasis: resolveAnnualBasis(monthly?.amountMinor ?? null, annual?.amountMinor ?? null, billed),
      perSeat, seatUnit,
      isFree: monthly?.amountMinor === 0 || annual?.amountMinor === 0,
      isCustom: !prices.length && custom,
      order: found.length,
      confidence: Math.min(1, Number(confidence.toFixed(2))),
      quote: quote(`${label} — ${win.slice(0, 120)}`),
      seatClasses: classes.length >= 2 ? classes : undefined,
      _grounded: perSeat || hasPeriodText,
      _at: i,
    });
  }

  // Layouts repeat (mobile + desktop, plus a comparison table). Keep the
  // best-evidenced instance per (line, tier) and prefer one that has a price.
  const best = new Map<string, Tier>();
  for (const t of found) {
    const key = `${t.productLine ?? ""}|${t.slug}`;
    const prev = best.get(key);
    const better = !prev
      || (prev.monthly === null && prev.annual === null && (t.monthly !== null || t.annual !== null))
      || (t.confidence > prev.confidence && (t.monthly !== null || t.annual !== null || prev.monthly === null));
    if (better) best.set(key, { ...t, order: prev?.order ?? t.order });
  }
  let tiers = [...best.values()].map((t, idx) => ({ ...t, order: idx }));

  /**
   * LADDER COHERENCE.
   *
   * notion's comparison table has rows labelled "Basic" and "Advanced" sitting
   * near the $8 Notion-AI price, which produced two phantom tiers. Real tiers on
   * a given page almost always carry period or seat evidence ("per member /
   * month"); the phantoms carry none. So once at least two tiers DO have that
   * evidence, a priced tier with none of it is noise rather than a plan.
   */
  const grounded = tiers.filter((t) => t._grounded || t.isFree || t.isCustom);
  if (grounded.length >= 2 && grounded.length < tiers.length) {
    const dropped = tiers.filter((t) => !grounded.includes(t)).map((t) => t.name);
    tiers = grounded.map((t, idx) => ({ ...t, order: idx }));
    if (dropped.length) notesFromFilter.push(`ignored ${dropped.length} price-shaped row(s) with no period/seat evidence: ${dropped.join(", ")}`);
  }

  /**
   * POSITIONAL CLUSTERING.
   *
   * A pricing ladder is laid out together. notion's feature-comparison table,
   * hundreds of nodes below the cards, has rows labelled "Basic" and "Advanced"
   * sitting near the $8 Notion-AI price — which looked exactly like two extra
   * tiers. Real tiers cluster; stray table rows do not, so keep the largest
   * contiguous group and say what was discarded.
   */
  if (tiers.length >= 4) {
    const withPos = tiers.filter((t) => typeof t._at === "number").sort((a, b) => (a._at ?? 0) - (b._at ?? 0));
    if (withPos.length >= 4) {
      const gaps = withPos.slice(1).map((t, i) => (t._at ?? 0) - (withPos[i]._at ?? 0));
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1;
      const limit = Math.max(40, median * 6);
      const groups: Tier[][] = [[withPos[0]]];
      withPos.slice(1).forEach((t, i) => {
        if (gaps[i] > limit) groups.push([t]);
        else groups[groups.length - 1].push(t);
      });
      const biggest = groups.reduce((a, b) => (b.length > a.length ? b : a));
      // A contact-sales tier is usually presented apart from the ladder, so it
      // is kept regardless of position — linear's Enterprise was being lost.
      const keep = withPos.filter((t) => biggest.includes(t) || t.isCustom);
      if (biggest.length >= 3 && keep.length < withPos.length) {
        const cut = withPos.filter((t) => !keep.includes(t)).map((t) => t.name);
        notesFromFilter.push(`ignored ${cut.length} row(s) outside the main ladder: ${cut.join(", ")}`);
        tiers = keep.map((t, idx) => ({ ...t, order: idx }));
      }
    }
  }

  tiers = tiers.map(({ _grounded: _g, _at: _a, ...t }) => t as Tier);
  const currencies = new Set(tiers.flatMap((t) => [t.monthly?.currency, t.annual?.currency]).filter(Boolean) as string[]);
  const notes: string[] = [...notesFromFilter];
  if (currencies.size > 1) notes.push(`mixed currencies on page: ${[...currencies].join(" ")}`);
  if (!tiers.length) notes.push("no tiers matched — likely JS-rendered or an unusual layout");

  return {
    tiers, productLines: [],
    currencyObserved: [...currencies][0] ?? null,
    source: tiers.length ? "text" : "none",
    notes,
  };
}

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

export function extractPricing(html: string): PricingShape {
  return fromJsonLd(html) ?? fromFramework(html) ?? fromText(html);
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export function pricingFacts(shape: PricingShape, url: string): Fact[] {
  const f: Fact[] = [
    // Disclosed on purpose: a buyer should know whether a number was READ from
    // structured data or INFERRED from prose.
    { path: "pricing.extraction_source", value: shape.source, sourceUrl: url, confidence: 1 },
    { path: "pricing.tiers.count", value: shape.tiers.length, sourceUrl: url, confidence: 1 },
    { path: "pricing.lines.count", value: Math.max(1, shape.productLines.length), sourceUrl: url, confidence: 1 },
  ];
  if (!shape.tiers.length) {
    f.push({ path: "pricing.visible", value: false, sourceUrl: url, confidence: 1 });
    return f;
  }

  f.push(
    { path: "pricing.visible", value: true, sourceUrl: url, confidence: 1 },
    { path: "pricing.currency_observed", value: shape.currencyObserved, sourceUrl: url, confidence: 1 },
    // Ordered, so a rename, a reorder or a new middle tier all show up as a diff.
    { path: "pricing.tiers.names", value: shape.tiers.map((t) => t.name).join(" | "), sourceUrl: url, confidence: 1 },
    { path: "pricing.has_free", value: shape.tiers.some((t) => t.isFree), sourceUrl: url, confidence: 1 },
    { path: "pricing.has_custom", value: shape.tiers.some((t) => t.isCustom), sourceUrl: url, confidence: 1 },
    { path: "pricing.has_enterprise", value: shape.tiers.some((t) => /enterprise/i.test(t.name)), sourceUrl: url, confidence: 1 },
    { path: "pricing.has_agency", value: shape.tiers.some((t) => /agency|partner|reseller/i.test(t.name)), sourceUrl: url, confidence: 1 },
  );
  if (shape.productLines.length) {
    f.push({ path: "pricing.lines.names", value: shape.productLines.join(" | "), sourceUrl: url, confidence: 1 });
  }

  const paid = shape.tiers.filter((t) => !t.isFree && !t.isCustom);
  const cheapest = paid
    .map(monthlyEquivalentMinor)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b)[0];
  if (cheapest !== undefined) {
    f.push({ path: "pricing.cheapest_paid_minor", value: cheapest, sourceUrl: url, confidence: 0.9 });
  }

  for (const t of shape.tiers) {
    const line = t.productLine ? slugify(t.productLine) : "default";
    const base = `pricing.tier.${line}.${t.slug}`;
    f.push({ path: `${base}.name`, value: t.name, sourceUrl: url, confidence: t.confidence, quote: t.quote });
    if (t.monthly) f.push({ path: `${base}.monthly_minor`, value: t.monthly.amountMinor, sourceUrl: url, confidence: t.confidence, quote: t.quote });
    if (t.annual) f.push({ path: `${base}.annual_minor`, value: t.annual.amountMinor, sourceUrl: url, confidence: t.confidence, quote: t.quote });
    if (t.annualBasis) f.push({ path: `${base}.annual_basis`, value: t.annualBasis, sourceUrl: url, confidence: t.confidence });
    const canon = monthlyEquivalentMinor(t);
    if (canon !== null) {
      // The number comparison pages actually use.
      f.push({ path: `${base}.monthly_equivalent_minor`, value: canon, sourceUrl: url, confidence: t.confidence });
    }
    f.push({ path: `${base}.per_seat`, value: t.perSeat, sourceUrl: url, confidence: t.confidence });
    if (t.seatClasses?.length) {
      f.push({ path: `${base}.seat_classes`, value: t.seatClasses.join(","), sourceUrl: url, confidence: t.confidence });
    }
    if (t.seatUnit) f.push({ path: `${base}.seat_unit`, value: t.seatUnit, sourceUrl: url, confidence: t.confidence });
    if (t.isCustom) f.push({ path: `${base}.is_custom`, value: true, sourceUrl: url, confidence: t.confidence });

    // Derived, and the number marketers actually quote.
    if (t.monthly && t.annual && t.annualBasis === "per-month" && t.monthly.amountMinor > 0) {
      const pct = Math.round(((t.monthly.amountMinor - t.annual.amountMinor) / t.monthly.amountMinor) * 100);
      if (pct > 0) {
        // Beyond ~40% the two numbers were probably never a monthly/annual pair.
        const dubious = pct > IMPLAUSIBLE_DISCOUNT_PCT;
        f.push({
          path: `pricing.annual_discount_pct.${line}.${t.slug}`, value: pct, sourceUrl: url,
          confidence: dubious ? 0.4 : t.confidence,
        });
        if (dubious) {
          f.push({
            path: "pricing.note", sourceUrl: url, confidence: 1,
            value: `${t.name}: implied ${pct}% annual discount is implausible — the monthly/annual pair is probably wrong, needs visual review`,
          });
        }
      }
    }
  }

  // The change trigger: any tier, price, period or seat basis moving alters it.
  const fp = shape.tiers
    .map((t) => `${t.productLine ?? ""}/${t.slug}:${t.monthly?.amountMinor ?? "-"}/${t.annual?.amountMinor ?? "-"}${t.perSeat ? "s" : ""}${t.isCustom ? "c" : ""}`)
    .join("|");
  f.push({ path: "pricing.fingerprint", value: fp.slice(0, 4000), sourceUrl: url, confidence: 1 });

  for (const n of shape.notes) {
    f.push({ path: "pricing.note", value: n, sourceUrl: url, confidence: 1 });
  }
  return f;
}
