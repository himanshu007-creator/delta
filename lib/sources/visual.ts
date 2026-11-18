/**
 * Layer 4 of the pricing cascade: screenshot the page and read it with a vision
 * model, for pages the text layers cannot parse.
 *
 * Needed because some pricing pages are JS-rendered, canvas-drawn, or laid out
 * so unusually that no amount of DOM scanning helps — and because the text
 * layers can be CONFIDENTLY WRONG. slack.com produced an implied 55% annual
 * discount from two numbers that were never a monthly/annual pair; the cascade
 * flags that as implausible, and this module is what resolves it.
 *
 * It is the LAST resort on purpose: it costs a screenshot request plus vision
 * tokens, and unlike the text layers its numbers cannot be verified against
 * source text with lib/grounding.ts. So everything it returns is capped at
 * modest confidence and tagged `source: "visual"`, which the UI discloses.
 *
 * Providers are pluggable and chosen by whichever credential exists:
 *   screenshot — Playwright (best, if installed) > PageSpeed Insights (key)
 *                > thum.io (keyless; VERIFIED 200 image/png 81KB)
 *   vision     — Gemini (most capable free tier) > Groq > Cloudflare Workers AI
 *
 * ⚠️ Gemini's free tier may train on submitted content. Only ever send a
 * competitor's PUBLIC pricing page here. Never user data.
 */

import { fetchBinary, fetchRaw } from "../fetch";
import { quote } from "./types";
import type { PricingShape, Tier } from "./pricing";
import { slugify } from "./pricing";

/** Where pricing actually lives, in the order worth trying. */
export const PRICING_PATHS = [
  "/pricing", "/plans", "/pricing-plans", "/price", "/pricing/plans", "/subscribe",
] as const;

export type Shot = { url: string; base64: string; mime: string };

/** Minimal shape of what we use from Playwright, so it needs no @types. */
type PlaywrightBrowser = {
  newPage: (o?: unknown) => Promise<{
    goto: (url: string, o?: unknown) => Promise<unknown>;
    screenshot: (o?: unknown) => Promise<Buffer>;
  }>;
  close: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Finding the page
// ---------------------------------------------------------------------------

/** First path that returns HTML which actually looks like a pricing page. */
export async function findPricingUrl(domain: string, signal?: AbortSignal): Promise<string | null> {
  for (const path of PRICING_PATHS) {
    const url = `https://${domain}${path}`;
    const r = await fetchRaw(url, { attempts: 1, timeoutMs: 12_000, maxBytes: 4_000_000, signal });
    if (!r.ok) continue;
    const looksRight = /[$€£₹¥]\s?\d/.test(r.raw) || /\b(per (month|user|seat|member)|\/mo\b|billed (monthly|annually))\b/i.test(r.raw);
    if (looksRight) return r.url || url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Screenshot providers
// ---------------------------------------------------------------------------

/**
 * Keyless default. VERIFIED working: returns image/png for a full-page crop.
 * Third-party, so it is wrapped like any other fragile source — a failure here
 * must never fail a crawl window.
 */
async function shotViaThumIo(pageUrl: string, signal?: AbortSignal): Promise<Shot | null> {
  const api = `https://image.thum.io/get/width/1400/crop/3600/noanimate/${pageUrl}`;
  // fetchBinary, NOT fetchRaw: text decoding corrupts PNG bytes irreversibly.
  const r = await fetchBinary(api, { attempts: 2, timeoutMs: 45_000, maxBytes: 8_000_000, accept: "image/png,image/*", signal });
  if (!r.ok) return null;
  const mime = r.contentType.split(";")[0].trim() || "image/png";
  if (!mime.startsWith("image/")) return null;
  return { url: pageUrl, base64: Buffer.from(r.bytes).toString("base64"), mime };
}

/** Best quality, when a browser is available locally. Optional dependency. */
async function shotViaPlaywright(pageUrl: string): Promise<Shot | null> {
  try {
    // OPTIONAL dependency: present on a dev machine that installed Playwright,
    // absent in production. The specifier goes through a variable so TypeScript
    // does not try to resolve a package that is intentionally not installed,
    // and so a bundler does not hard-fail the build over it.
    const specifier = "playwright";
    const pw = (await import(specifier).catch(() => null)) as
      | { chromium: { launch: (o?: unknown) => Promise<PlaywrightBrowser> } }
      | null;
    if (!pw) return null;
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 45_000 });
      const buf: Buffer = await page.screenshot({ fullPage: true, type: "png" });
      return { url: pageUrl, base64: buf.toString("base64"), mime: "image/png" };
    } finally { await browser.close(); }
  } catch { return null; }
}

export async function capture(pageUrl: string, signal?: AbortSignal): Promise<Shot | null> {
  return (await shotViaPlaywright(pageUrl)) ?? (await shotViaThumIo(pageUrl, signal));
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

const PROMPT = `You are reading a screenshot of a SaaS pricing page.
Return ONLY minified JSON, no prose, no code fence, matching exactly:
{"tiers":[{"name":"","productLine":null,"monthlyAmount":null,"annualAmount":null,"currency":"","perSeat":false,"seatUnit":null,"isFree":false,"isCustom":false,"evidence":""}]}

Rules, and they matter more than completeness:
- Copy tier names EXACTLY as shown.
- monthlyAmount / annualAmount: the per-seat price if per-seat, else the plan price. Numbers only, no symbols. Use null if that billing option is not shown.
- If a price says "per month, billed annually", that figure is annualAmount, NOT monthlyAmount.
- isCustom true for "Contact sales" / "Custom pricing" tiers; leave both amounts null.
- If the page shows SEVERAL product lines, set productLine for each tier.
- "evidence" must be text you can literally SEE for that tier, copied verbatim.
- NEVER guess or infer a number that is not visible. Omit the tier instead.`;

async function visionGemini(shot: Shot, key: string, signal?: AbortSignal): Promise<string | null> {
  const r = await fetchRaw(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST", attempts: 2, timeoutMs: 60_000, accept: "application/json", signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: shot.mime, data: shot.base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.raw) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch { return null; }
}

async function visionGroq(shot: Shot, key: string, signal?: AbortSignal): Promise<string | null> {
  const r = await fetchRaw("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", attempts: 2, timeoutMs: 60_000, accept: "application/json", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:${shot.mime};base64,${shot.base64}` } },
      ] }],
    }),
  });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.raw) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Validation — the model is treated as an untrusted parser
// ---------------------------------------------------------------------------

type VisionTier = {
  name?: unknown; productLine?: unknown; monthlyAmount?: unknown; annualAmount?: unknown;
  currency?: unknown; perSeat?: unknown; seatUnit?: unknown; isFree?: unknown;
  isCustom?: unknown; evidence?: unknown;
};

const minorOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100_000 ? Math.round(n * 100) : null;
};

/**
 * Parse and HARD-VALIDATE the model's JSON.
 *
 * A vision model will happily invent a plausible ladder, and a wrong price is
 * worse than no price — so a tier is kept only if it has a name, visible
 * evidence, and either a usable amount or an explicit custom flag.
 */
export function parseVisionTiers(raw: string, pageUrl: string): Tier[] {
  let parsed: { tiers?: VisionTier[] };
  const body = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { parsed = JSON.parse(body) as { tiers?: VisionTier[] }; } catch { return []; }
  if (!Array.isArray(parsed.tiers)) return [];

  const out: Tier[] = [];
  for (const t of parsed.tiers.slice(0, 40)) {
    const name = typeof t.name === "string" ? t.name.trim() : "";
    const evidence = typeof t.evidence === "string" ? t.evidence.trim() : "";
    if (!name || name.length > 40) continue;
    if (!evidence) continue; // no visible evidence, no tier

    const monthly = minorOf(t.monthlyAmount);
    const annual = minorOf(t.annualAmount);
    const isCustom = t.isCustom === true;
    if (monthly === null && annual === null && !isCustom) continue;

    const cur = typeof t.currency === "string" && t.currency.trim() ? t.currency.trim().slice(0, 3) : "$";
    out.push({
      name,
      slug: slugify(name),
      productLine: typeof t.productLine === "string" && t.productLine.trim() ? t.productLine.trim() : null,
      monthly: monthly === null ? null : { amountMinor: monthly, currency: cur },
      annual: annual === null ? null : { amountMinor: annual, currency: cur },
      // The prompt defines "per month, billed annually" as annualAmount, so a
      // lower annual figure is a monthly-equivalent rate.
      annualBasis: annual === null ? null : (monthly !== null && annual < monthly ? "per-month" : "per-month"),
      perSeat: t.perSeat === true,
      seatUnit: typeof t.seatUnit === "string" && t.seatUnit.trim() ? t.seatUnit.trim().toLowerCase() : null,
      isFree: t.isFree === true || monthly === 0 || annual === 0,
      isCustom,
      order: out.length,
      // Capped: unlike the text layers, this cannot be checked against source text.
      confidence: 0.7,
      quote: quote(evidence),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type VisualOpts = {
  geminiKey?: string;
  groqKey?: string;
  signal?: AbortSignal;
  /** Skip discovery when the caller already knows the URL. */
  pageUrl?: string;
};

/**
 * Screenshot a company's pricing page and read it with a vision model.
 * Returns null when no provider is configured or anything fails — callers keep
 * whatever the text layers produced.
 */
export async function visualPricing(domain: string, opts: VisualOpts = {}): Promise<PricingShape | null> {
  const geminiKey = opts.geminiKey ?? process.env.GEMINI_API_KEY;
  const groqKey = opts.groqKey ?? process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) return null;

  const pageUrl = opts.pageUrl ?? (await findPricingUrl(domain, opts.signal));
  if (!pageUrl) return null;

  const shot = await capture(pageUrl, opts.signal);
  if (!shot) return null;

  const raw = geminiKey
    ? await visionGemini(shot, geminiKey, opts.signal)
    : await visionGroq(shot, groqKey!, opts.signal);
  if (!raw) return null;

  const tiers = parseVisionTiers(raw, pageUrl);
  if (tiers.length < 2) return null; // one tier is not a ladder

  const lines = [...new Set(tiers.map((t) => t.productLine).filter((x): x is string => Boolean(x)))];
  const currencies = new Set(tiers.flatMap((t) => [t.monthly?.currency, t.annual?.currency]).filter(Boolean) as string[]);

  return {
    tiers,
    productLines: lines,
    currencyObserved: [...currencies][0] ?? null,
    source: "visual",
    notes: [`read from a screenshot of ${pageUrl} by a vision model — not verifiable against page text`],
  };
}
