/**
 * Legal and regulatory intelligence.
 *
 * This is the module most able to do damage, so it is the most constrained.
 * An insolvency notice attached to the wrong company is a defamatory claim
 * about a solvent business, and the naive implementation produces exactly
 * that: querying The Gazette's insolvency category for "Linear" returns 139
 * notices — "Appointment of Liquidators", "Final Meetings" — not one of which
 * concerns Linear the issue tracker. The word merely appears somewhere.
 *
 * Two rules make it safe, and both were derived from that failure:
 *
 *  1. ONLY a registered legal name is ever queried, suffix included
 *     ("Carillion plc", not "Carillion"). A trading name is not an entity.
 *  2. The NOTICE ITSELF must name the company in its title. The query is a
 *     search; the title is the evidence. "Carillion plc" returns one notice
 *     titled CARILLION PLC and is reported; the 139 for "Linear" name other
 *     companies entirely and are all discarded.
 *
 * PRIVACY. Every notice carries the insolvency practitioner's given name and
 * family name. Those fields are never read, never stored and never published.
 * The unit of this product is the company; a person acting in a professional
 * capacity is not a subject here, and compiling people across public records
 * is the line between competitive intelligence and surveillance.
 */

import type { Adapter, Company, Fact } from "./types";
import { quote } from "./types";

/**
 * Company-type suffixes that mark a UK registered entity.
 *
 * The suffix is doing real work: it is what makes the query an entity lookup
 * rather than a word search, and it also scopes the adapter to the only
 * jurisdiction this source covers. A US corporation never reaches The Gazette.
 */
const UK_SUFFIX =
  /\b(limited|ltd\.?|p\.?l\.?c\.?|llp|llc|c\.?i\.?c\.?|limited liability partnership|unlimited)$/i;

export const ukLegalName = (c: Company): string | null => {
  const name = c.legalName?.trim();
  if (!name || name.length < 6 || name.length > 160) return null;
  return UK_SUFFIX.test(name) ? name : null;
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(limited|ltd|plc|p l c|llp|llc|cic|unlimited)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Insolvency and winding-up. The Gazette's own category code. */
const INSOLVENCY = "G205010000";

const feedUrl = (name: string) =>
  `https://www.thegazette.co.uk/all-notices/notice/data.feed?text=${encodeURIComponent(`"${name}"`)}` +
  `&categorycode=${INSOLVENCY}`;

/**
 * Entries whose own title names this company.
 *
 * Parsed with regexes rather than an XML library on purpose: the feed is
 * Atom with a handful of custom elements, the adapter contract hands us the
 * raw body, and adding a parser dependency to read two fields is not worth
 * the surface. Only `<title>` and `<id>` are ever touched — the practitioner
 * name fields in the same entry are deliberately not parsed at all.
 */
export function insolvencyFacts(raw: string, legalName: string, sourceUrl: string): Fact[] {
  const target = normalise(legalName);
  if (!target) return [];

  const entries = raw.split("<entry>").slice(1);
  const matched: { title: string; id: string }[] = [];

  for (const e of entries) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1]?.trim() ?? "";
    if (!title) continue;
    // The evidence step. A notice that does not name this company is a
    // notice about someone else, however the search matched it.
    if (normalise(title) !== target) continue;
    const id = /<id>([\s\S]*?)<\/id>/.exec(e)?.[1]?.trim() ?? "";
    matched.push({ title, id });
  }

  /*
   * Zero matches is a FINDING, not an absence.
   *
   * "We searched the insolvency register for this registered name and it
   * holds nothing" is worth stating plainly, and it is the answer for almost
   * every healthy company. Returning no facts would make it indistinguishable
   * from never having looked — the same confusion that had a public company
   * described as not filing with the SEC.
   */
  if (matched.length === 0) {
    return [
      {
        path: "legal.insolvency.notices",
        value: 0,
        confidence: 1,
        sourceUrl,
        quote: quote(`No insolvency notice in The Gazette names ${legalName}`),
      },
    ];
  }

  return [
    {
      path: "legal.insolvency.notices",
      value: matched.length,
      confidence: 1,
      sourceUrl,
      quote: quote(
        `${matched.length} insolvency notice${matched.length === 1 ? "" : "s"} name ${legalName} in the title`,
      ),
    },
    {
      path: "legal.insolvency.latest_notice",
      value: matched[0].id || sourceUrl,
      confidence: 1,
      sourceUrl,
      quote: quote(matched[0].title, 120),
    },
  ];
}

export const LEGAL_ADAPTERS: Adapter[] = [
  {
    kind: "legal.insolvency",
    module: "16. Legal & regulatory",
    label: "The Gazette — insolvency notices",
    cadence: "weekly",
    tier: "A",
    format: "text",
    // Gated on a REGISTERED name with its suffix. A trading name, or a name we
    // only suspect, produces no query at all.
    url: (c) => {
      const name = ukLegalName(c);
      return name ? feedUrl(name) : null;
    },
    rate: { minIntervalMs: 1500 },
    timeoutMs: 12_000,
    extract: (_b, ctx) => insolvencyFacts(ctx.raw, ukLegalName(ctx.company) ?? "", ctx.url),
  },
];
