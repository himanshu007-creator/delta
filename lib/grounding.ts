/**
 * The anti-hallucination guarantee.
 *
 * Every opener the model writes must quote a sentence that actually appears on
 * the prospect's site. We do not trust the model to honour that — we check it.
 * A quote that doesn't match the source is a FABRICATION and the row is
 * dropped, not shipped.
 *
 * This is the product. If this file is wrong, we are selling a lie.
 */

import type { Sentence } from "./research";

/**
 * Em and en dashes are banned by the user, and they are also one of the
 * loudest tells that a human did not write the email. Normalize rather than
 * reject: the model ignoring a formatting rule is not a reason to throw away
 * a well-grounded email.
 */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s*,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type GroundingVerdict =
  | { ok: true; quote: string; sourceUrl: string }
  | { ok: false; reason: "no-quote" | "fabricated" | "empty-line" };

/**
 * Whitespace and typographic quotes/dashes vary between what a page serves and
 * what a model echoes back. Those differences are not fabrication, so we
 * normalize them away before comparing. Nothing else is normalized — in
 * particular we never drop or reorder words.
 */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Verify a model-produced quote against the sentences we actually fetched.
 *
 * Returns the matching source URL so the receipt can link the citation.
 */
export function verifyQuote(
  quote: string | null | undefined,
  line: string | null | undefined,
  sentences: Sentence[],
): GroundingVerdict {
  if (!line || !line.trim()) return { ok: false, reason: "empty-line" };
  if (!quote || !quote.trim()) return { ok: false, reason: "no-quote" };

  const needle = normalizeForCompare(quote);
  // A two-word "quote" matches almost anything; that's not grounding.
  if (needle.length < 25) return { ok: false, reason: "fabricated" };

  for (const s of sentences) {
    if (normalizeForCompare(s.text).includes(needle)) {
      return { ok: true, quote: quote.trim(), sourceUrl: s.sourceUrl };
    }
  }
  return { ok: false, reason: "fabricated" };
}

/**
 * Openers that are technically grounded but say nothing. These are the lines
 * that make cold email feel like cold email, so we drop them too.
 */
const FILLER = [
  // Openings that say nothing.
  /^(hi|hey|hello|dear)\b/i,
  /\bi (came across|stumbled upon|was looking at|noticed|saw that|happened to see)\b/i,
  /\bi hope (this|you|your)\b/i,
  /\b(just )?reaching out\b/i,
  // Compliments.
  /\blove what (you|you're|your team)\b/i,
  /\b(impressive|amazing|awesome|fantastic|incredible) (website|site|work|stuff|team)\b/i,
  /\byour (website|site) (is|looks)\b/i,
  // Pitch and CTA — this is a first line, not an ask.
  /\bquick (question|chat|call)\b/i,
  /\b(book|schedule|hop on|jump on) a (call|demo|chat)\b/i,
  /\bwould you be (open|interested|available)\b/i,
  /\blet me know if\b/i,
  // Hype vocabulary.
  /\b(game.?chang|cutting.?edge|world.?class|best.?in.?class|revolutionar|disrupt)/i,
  /\b(thrilled|excited|passionate) (to|about)\b/i,
  /\bleading provider\b/i,
];

/** A line that is mostly their own tagline handed back is not an observation. */
function echoesSource(line: string, quote: string): boolean {
  const l = normalizeForCompare(line);
  const q = normalizeForCompare(quote);
  if (!l || !q) return false;
  if (q.includes(l) && l.length > 30) return true;
  const lw = new Set(l.split(" ").filter((w) => w.length > 4));
  if (lw.size < 4) return false;
  const qw = new Set(q.split(" ").filter((w) => w.length > 4));
  let shared = 0;
  for (const w of lw) if (qw.has(w)) shared++;
  return shared / lw.size > 0.8;
}

export function isFiller(line: string, quote = ""): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.includes("!")) return true; // no exclamation marks, ever
  if (t.split(/\s+/).length > 40) return true; // a paragraph is not a first line
  if (FILLER.some((re) => re.test(t))) return true;
  return echoesSource(t, quote);
}

// --- Specificity ------------------------------------------------------------

/**
 * Could this email have been sent to any other company?
 *
 * A line is specific when it carries a concrete token it could only have got
 * from THIS prospect: a figure, or a proper noun that also appears in the
 * quoted source. Everything else is the kind of smooth, interchangeable
 * sentence every AI writer produces.
 *
 * Per the product decision this WARNS rather than drops — a weak line is
 * badged and withheld from the sending-tool exports, never silently binned.
 */
export type Specificity = { specific: boolean; reason?: string };

const STOPWORDS = new Set([
  "their","there","these","those","which","while","would","could","should","about","after","before",
  "every","other","another","being","because","through","where","what","when","your","yours","company",
  "companies","business","team","teams","product","products","customer","customers","platform","software",
  "service","services","people","first","using","build","building","helps","making",
]);

export function specificity(line: string, quote: string): Specificity {
  const l = line.trim();
  if (!l) return { specific: false, reason: "empty" };

  // A figure is the strongest possible proof the line came from their page.
  const lineNums: string[] = l.match(/\d[\d,.]*/g) ?? [];
  const quoteNums: string[] = quote.match(/\d[\d,.]*/g) ?? [];
  if (lineNums.some((n) => quoteNums.includes(n))) return { specific: true };

  // Otherwise: a distinctive proper noun shared with the source.
  const propers = (l.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => !STOPWORDS.has(w));
  const qLower = normalizeForCompare(quote);
  const shared = propers.filter((w) => qLower.includes(w));
  if (shared.length > 0) return { specific: true };

  // A rare, long word carried across also counts as evidence.
  const rare = normalizeForCompare(l)
    .split(" ")
    .filter((w) => w.length >= 8 && !STOPWORDS.has(w))
    .filter((w) => qLower.includes(w));
  if (rare.length > 0) return { specific: true };

  return {
    specific: false,
    reason: "No figure or distinctive term from their site, so this could be sent to any company",
  };
}
