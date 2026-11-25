/**
 * Cross-source correlation.
 *
 * Everything else in this product reports observations. This is the only part
 * that puts two of them together, and that makes it the easiest place to lie.
 *
 * Three rules, and each exists because the obvious implementation breaks it:
 *
 *  1. AT LEAST TWO SOURCES. A pattern drawn from one adapter is not a
 *     correlation, it is that adapter restated with a confident verb.
 *  2. ALTERNATIVE EXPLANATIONS ARE MANDATORY. Every insight carries the most
 *     plausible innocent reading of the same evidence. If we cannot write one,
 *     the insight is not an inference — it is a fact, and belongs upstream.
 *  3. NO CAUSATION. The language is "consistent with", never "because".
 *     Hiring salespeople and publishing enterprise pricing co-occur for many
 *     reasons, and the honest claim is the co-occurrence.
 *
 * Confidence here describes the STRENGTH OF THE PATTERN, not the reliability
 * of the underlying facts — those carry their own confidence and sources.
 */

import type { FactMap } from "./cached-dossier";

export type Insight = {
  id: string;
  /** What a person would say out loud. Hedged, because it is an inference. */
  headline: string;
  /** Why a reader should care. One line. */
  soWhat: string;
  /** The observations behind it, each with the source it came from. */
  evidence: { label: string; value: string; source: string | null }[];
  /** The innocent reading of the same evidence. Never optional. */
  alternative: string;
  /** What this cannot tell you. */
  limitation: string;
  /** How strong the PATTERN is — not how reliable the facts are. */
  strength: "suggestive" | "moderate" | "strong";
  tone: "neutral" | "good" | "warn";
};

const num = (f: FactMap, p: string): number | null => {
  const v = f.get(p)?.value;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (f: FactMap, p: string): string | null => f.get(p)?.value ?? null;
const src = (f: FactMap, p: string): string | null => f.get(p)?.sourceUrl ?? null;
const ev = (f: FactMap, label: string, path: string, value?: string) =>
  ({ label, value: value ?? String(f.get(path)?.value ?? ""), source: src(f, path) });

/**
 * Insights, in the order a reader should meet them.
 *
 * Each rule reads facts from at least two different adapters and returns
 * nothing when the evidence is incomplete. Silence is the correct output for
 * most companies on most rules — a correlation engine that always finds
 * something is a horoscope.
 */
export function correlate(f: FactMap): Insight[] {
  const out: Insight[] = [];

  // --- go-to-market push: hiring mix + published enterprise pricing -------
  const sales = num(f, "hiring.function.sales") ?? 0;
  const eng = num(f, "hiring.function.engineering") ?? 0;
  const roles = num(f, "hiring.open_roles") ?? 0;
  const hasCustom = str(f, "pricing.has_custom");
  if (roles >= 20 && sales > 0 && sales >= eng && hasCustom === "true") {
    out.push({
      id: "gtm-push",
      headline: "Hiring and pricing are both pointed at larger customers",
      soWhat:
        "Sales headcount at or above engineering, alongside a contact-sales tier, is what an enterprise " +
        "motion looks like while it is being built.",
      evidence: [
        ev(f, "Open sales roles", "hiring.function.sales"),
        ev(f, "Open engineering roles", "hiring.function.engineering"),
        ev(f, "Contact-sales tier published", "pricing.has_custom"),
      ],
      alternative:
        "A sales team can be rebuilt after attrition rather than expanded, and a contact-sales tier may " +
        "have existed for years. Neither observation is dated.",
      limitation: "Open roles are postings, not hires. Nothing here shows whether any were filled.",
      strength: sales > eng ? "moderate" : "suggestive",
      tone: "neutral",
    });
  }

  // --- geographic expansion: hiring locations + published locales ---------
  const locales = num(f, "geo.locales.count");
  const locations = num(f, "hiring.locations.count");
  if ((locations ?? 0) >= 3 && (locales ?? 0) >= 2) {
    out.push({
      id: "geo-expansion",
      headline: "They are hiring across more places than they publish languages for",
      soWhat:
        "Hiring geography usually moves before a market is marketed to, so the gap is where they may be " +
        "going next.",
      evidence: [
        ev(f, "Hiring locations", "hiring.locations.count"),
        ev(f, "Published locales", "geo.locales.count"),
      ],
      alternative:
        "Remote-first hiring spreads locations with no market intent at all, and one office can serve many " +
        "markets.",
      limitation:
        "A job board location is where the role sits, not where the customers are. No revenue by region is " +
        "published.",
      strength: "suggestive",
      tone: "neutral",
    });
  }

  // --- engineering investment: velocity + releases + hiring ---------------
  const commits = num(f, "product.github.commits_52w");
  const releases = num(f, "product.github.releases_count") ?? num(f, "product.github.latest_release_at") !== null ? 1 : 0;
  if ((commits ?? 0) > 0 && eng >= 5 && releases) {
    out.push({
      id: "eng-investment",
      headline: "Public engineering output and engineering hiring are moving together",
      soWhat:
        "Commit activity, shipped releases and open engineering roles agreeing is the clearest free signal " +
        "that a product is being invested in rather than maintained.",
      evidence: [
        ev(f, "Commits, trailing 52 weeks", "product.github.commits_52w"),
        ev(f, "Open engineering roles", "hiring.function.engineering"),
      ],
      alternative:
        "Commit volume reflects team size and working style, not progress. A large refactor and a major " +
        "feature look identical from outside.",
      limitation:
        "Only public repositories are visible. A company doing its real work in private shows nothing here.",
      strength: "moderate",
      tone: "good",
    });
  }

  // --- enterprise readiness: compliance claims + security posture ---------
  const compliance = str(f, "discovered.compliance_claims");
  const dmarc = str(f, "security.dmarc_policy");
  const scorecard = num(f, "security.scorecard.score");
  const enterpriseEvidence = [compliance === "true", dmarc === "reject" || dmarc === "quarantine", (scorecard ?? 0) >= 6].filter(Boolean);
  if (enterpriseEvidence.length >= 2) {
    out.push({
      id: "enterprise-ready",
      headline: "Several independent signals of enterprise readiness line up",
      soWhat:
        "Compliance claims backed by enforced email authentication and a public security score is a harder " +
        "posture to fake than a trust page alone.",
      evidence: [
        ...(compliance === "true" ? [ev(f, "Compliance claims on site", "discovered.compliance_claims")] : []),
        ...(dmarc ? [ev(f, "DMARC policy", "security.dmarc_policy")] : []),
        ...(scorecard !== null ? [ev(f, "OpenSSF Scorecard", "security.scorecard.score")] : []),
      ],
      alternative:
        "Each of these is cheap to put in place and says nothing about how controls operate day to day. A " +
        "claim on a page is not an audit.",
      limitation:
        "We read claims and public configuration, never the certificates themselves. Treat this as posture, " +
        "not assurance.",
      strength: enterpriseEvidence.length >= 3 ? "moderate" : "suggestive",
      tone: "good",
    });
  }

  // --- disclosed risk: advisories against their own package + severity ----
  const advisories = num(f, "security.advisories.count");
  const worst = str(f, "security.advisories.worst_severity");
  const disclosures = num(f, "security.disclosures.count");
  if ((advisories ?? 0) > 0 && (worst === "critical" || worst === "high")) {
    const runsProcess = (disclosures ?? 0) > 0;
    out.push({
      id: "security-disclosure",
      headline: runsProcess
        ? "They publish their own advisories, including high-severity ones"
        : "High-severity advisories exist against a package they publish",
      soWhat: runsProcess
        ? "A vendor that discloses its own high-severity issues is running a real security process. The " +
          "count is evidence of maturity, not of weakness."
        : "Worth knowing before a procurement conversation, and worth reading the dates before drawing any " +
          "conclusion.",
      evidence: [
        ev(f, "Advisories against their package", "security.advisories.count"),
        ev(f, "Worst severity", "security.advisories.worst_severity"),
        ...(runsProcess ? [ev(f, "Advisories they published", "security.disclosures.count")] : []),
      ],
      alternative:
        "Advisory counts track popularity and scrutiny at least as much as code quality. A widely used " +
        "package attracts more researchers.",
      limitation:
        "An advisory describes a version range and usually ships with its fix, so none of this says the " +
        "package is unsafe today.",
      strength: "moderate",
      tone: runsProcess ? "good" : "warn",
    });
  }

  // --- filed growth, corroborated by hiring -------------------------------
  const revGrowth = num(f, "financial.revenue.yoy_pct") ?? num(f, "financial.revenue_alt.yoy_pct");
  if (revGrowth !== null && roles > 0) {
    const growing = revGrowth > 0;
    out.push({
      id: "filed-growth",
      headline: growing
        ? "Filed revenue growth and an open job board point the same way"
        : "Filed revenue fell while the job board stayed open",
      soWhat: growing
        ? "Audited growth corroborated by current hiring is the strongest combination available here: one " +
          "side is a filing, the other is today."
        : "A decline in a filing alongside active hiring is worth reading carefully — the filing is older " +
          "than the postings.",
      evidence: [
        ev(f, "Revenue change, year over year", revGrowth === num(f, "financial.revenue.yoy_pct") ? "financial.revenue.yoy_pct" : "financial.revenue_alt.yoy_pct", `${revGrowth}%`),
        ev(f, "Open roles", "hiring.open_roles"),
      ],
      alternative:
        "The two observations are from different moments. A filing covers a year that ended months ago; a " +
        "job board is current.",
      limitation:
        "Revenue is as filed and may be restated. Headcount is not published, so postings are the only " +
        "proxy and a poor one.",
      strength: "strong",
      tone: growing ? "good" : "warn",
    });
  }

  return out;
}
