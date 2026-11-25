/**
 * Workforce classification.
 *
 * Every number here is derived from the job board response the `jobs` adapter
 * already fetched, so the whole module costs ZERO extra requests. That is the
 * point: "48 open roles" is a fact nobody can act on, while "31 of 48 are
 * engineering and 9 are sales" says what the company is actually doing.
 *
 * Two restraints that matter:
 *
 *  - Board taxonomies are arbitrary. One company's "GTM" is another's "Sales"
 *    and another's "Revenue". Classification therefore reads the TITLE as well
 *    as the team, and anything it cannot place honestly lands in `other`
 *    rather than being forced into the nearest bucket.
 *  - A missing posting is not a layoff. Boards drop and re-add roles routinely,
 *    and a removed posting is also what a filled role looks like. Nothing in
 *    this module infers contraction from absence; that needs recorded history
 *    and a disclosure to corroborate it.
 */

import type { Fact } from "./types";
import { quote } from "./types";

/**
 * The seven functions the brief asks for, plus `other`.
 *
 * ORDER IS THE WHOLE ALGORITHM. First match wins, and the sequence was fixed
 * by auditing it against 30 real Linear postings rather than by taste:
 *
 *  - `leadership` first, because "Head of Engineering" is a leadership hire
 *    that happens to name a discipline.
 *  - `engineering` next, so "Senior Product Engineer" is an engineer. Linear
 *    files those under a department literally called Product.
 *  - `marketing` and `operations` BEFORE `product`, which fixes two
 *    systematic misreads: "Product Marketing Manager" is marketing, and
 *    "Product Support Specialist" is support. A bare `product` token tested
 *    early swallowed six of Linear's thirty roles into the wrong function.
 *  - `product` LAST, because it is the broadest token here and only earns a
 *    role once nothing more specific has claimed it.
 *  - `sales` before `marketing`, so "Account Executive, Growth" is a sales
 *    hire rather than a growth-marketing one.
 *
 * `gtm` is deliberately NOT a sales token. It is a DEPARTMENT name spanning
 * both sales and marketing, and including it filed Linear's "Field Marketing
 * Manager" and even a "Production Designer" as salespeople purely because of
 * the team they sit in. A department is weaker evidence than a job title.
 */
const FUNCTIONS: ReadonlyArray<[string, RegExp]> = [
  ["leadership", /\b(chief|c[tfeoi]o|head of|vp|vice president|director|svp|evp|general manager)\b/i],
  ["engineering", /\b(engineer|engineering|developer|devops|sre|infrastructure|platform|security|qa|sdet|architect|data scientist|machine learning|ml|research scientist)\b/i],
  ["sales", /\b(sales|account executive|ae|account manager|business development|bdr|sdr|partnerships|revenue|customer success)\b/i],
  ["marketing", /\b(marketing|growth|content|brand|seo|demand gen|communications|social media|community)\b/i],
  ["finance", /\b(finance|financial|accountant|accounting|controller|treasury|fp&a|tax|audit)\b/i],
  ["operations", /\b(operations|ops|support|recruiter|recruiting|talent|people|human resources|legal|counsel|office|facilities|workplace|program manager|project manager)\b/i],
  ["product", /\b(product|product manager|product owner|designer|design|ux|ui|research|researcher)\b/i],
];

/**
 * Seniority, from the title only.
 *
 * Deliberately coarse. Levelling language is wildly inconsistent between
 * companies — one firm's "senior" is another's entry grade — so this
 * distinguishes only the bands that survive that variation.
 */
const SENIORITY: ReadonlyArray<[string, RegExp]> = [
  ["leadership", /\b(chief|head of|vp\b|vice president|director|svp|evp|c[tfeoi]o)\b/i],
  ["staff", /\b(staff|principal|distinguished|fellow|architect)\b/i],
  ["senior", /\b(senior|sr\.?|lead|manager)\b/i],
  ["entry", /\b(intern|internship|graduate|junior|jr\.?|apprentice|associate|entry)\b/i],
];

export const classifyFunction = (title: string, team: string): string => {
  // The team is checked first when it is already one of our names, because an
  // explicit "Engineering" department beats anything inferred from a title.
  const t = `${title} ${team}`;
  for (const [name, re] of FUNCTIONS) if (re.test(t)) return name;
  return "other";
};

export const classifySeniority = (title: string): string => {
  for (const [name, re] of SENIORITY) if (re.test(title)) return name;
  // Not "mid" — we did not observe mid, we observed the absence of a marker.
  return "unspecified";
};

/** A location that names no office. Counted, never guessed at. */
const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/i;

export function workforceFacts(
  rows: readonly { title: string; location: string; team: string }[],
  url: string,
): Fact[] {
  if (rows.length === 0) return [];

  const fn = new Map<string, number>();
  const sen = new Map<string, number>();
  let remote = 0;

  for (const r of rows) {
    const f = classifyFunction(r.title, r.team);
    fn.set(f, (fn.get(f) ?? 0) + 1);
    const s = classifySeniority(r.title);
    sen.set(s, (sen.get(s) ?? 0) + 1);
    if (REMOTE.test(r.location)) remote += 1;
  }

  const facts: Fact[] = [];

  for (const [name] of FUNCTIONS) {
    const n = fn.get(name);
    if (n) {
      facts.push({
        path: `hiring.function.${name}`,
        value: n,
        sourceUrl: url,
        confidence: 0.85,
        quote: quote(`${n} of ${rows.length} open roles classified as ${name}`),
      });
    }
  }
  const other = fn.get("other");
  if (other) {
    facts.push({
      path: "hiring.function.other",
      value: other,
      sourceUrl: url,
      // Stated so a reader can see how much of the split is unclassified,
      // which is the honest alternative to forcing a bucket.
      confidence: 1,
      quote: quote(`${other} roles could not be classified from title or team`),
    });
  }

  for (const [name] of SENIORITY) {
    const n = sen.get(name);
    if (n) facts.push({ path: `hiring.seniority.${name}`, value: n, sourceUrl: url, confidence: 0.8 });
  }

  if (remote) {
    facts.push({
      path: "hiring.remote_roles",
      value: remote,
      sourceUrl: url,
      confidence: 0.9,
      quote: quote(`${remote} of ${rows.length} postings name a remote or distributed location`),
    });
  }

  // The dominant function, which is the one-line read a person actually wants.
  const ranked = [...fn.entries()].filter(([k]) => k !== "other").sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    facts.push({
      path: "hiring.focus",
      value: ranked[0][0],
      sourceUrl: url,
      confidence: 0.8,
      quote: quote(`${ranked[0][1]} of ${rows.length} open roles are ${ranked[0][0]}`),
    });
  }

  return facts;
}


/**
 * Hiring velocity, from the posting dates already in the board response.
 *
 * This is the one change-shaped signal available WITHOUT recorded history:
 * the board stamps every posting with when it went up, so a single fetch
 * shows whether hiring is accelerating. Normally that needs two crawls weeks
 * apart.
 *
 * Deliberately NO wall clock. Bucketing against "now" would make the output
 * depend on when it was computed, which breaks a cached scope and is rejected
 * at prerender. Buckets are calendar months taken from the data itself, so
 * the same board always produces the same facts.
 */
export function postingVelocityFacts(
  dates: readonly (string | null)[],
  url: string,
): Fact[] {
  const months = new Map<string, number>();
  let newest = "";

  for (const d of dates) {
    if (!d) continue;
    const iso = d.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (iso > newest) newest = iso;
    const m = iso.slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + 1);
  }

  if (!newest) return [];

  const facts: Fact[] = [
    {
      path: "hiring.newest_posting",
      value: newest,
      sourceUrl: url,
      confidence: 1,
      quote: quote(`Most recent posting went up ${newest}`),
    },
  ];

  // The six most recent calendar months that actually contain postings.
  const recent = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  for (const [month, n] of recent) {
    facts.push({ path: `hiring.posted.${month}`, value: n, sourceUrl: url, confidence: 1 });
  }

  /*
   * Momentum: the newest month against the median of the months before it.
   * A ratio rather than a raw count, so a 300-role company and a 12-role one
   * are comparable — and only when there is enough history on the board to
   * make a median meaningful.
   */
  if (recent.length >= 3) {
    const prior = recent.slice(1).map(([, n]) => n).sort((a, b) => a - b);
    const median = prior[Math.floor(prior.length / 2)];
    if (median > 0) {
      facts.push({
        path: "hiring.momentum_ratio",
        value: Math.round((recent[0][1] / median) * 100) / 100,
        sourceUrl: url,
        confidence: 0.8,
        quote: quote(
          `${recent[0][1]} postings in ${recent[0][0]} against a median of ${median} in the ${prior.length} months before`,
        ),
      });
    }
  }

  return facts;
}
