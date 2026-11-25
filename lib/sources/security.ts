/**
 * Security intelligence — vulnerabilities in what a company PUBLISHES.
 *
 * The hard part here is not collecting advisories; it is refusing the easy
 * ones. A keyword search is the obvious route and it is wrong: NVD returns
 * 296 CVEs for the bare word "linear" — HDCP key exchange, an IDAutomation
 * barcode ActiveX control, a dozen unrelated products — and not one of them
 * concerns Linear the issue tracker. Publishing "296 known vulnerabilities"
 * against linear.app would be a fabricated finding assembled from true rows,
 * which is the specific failure this module is built to avoid.
 *
 * So every adapter here is keyed on an ARTEFACT WE KNOW IS THEIRS: a package
 * they publish, or a repository they own. That is evidence of exposure rather
 * than a coincidence of naming. A company with no public package and no public
 * repository gets no security facts, and that silence is correct.
 *
 * What this module does NOT claim:
 *  - that a company is vulnerable today. An advisory is a disclosure about a
 *    version range, and the fix usually ships with it.
 *  - that a company is insecure because it discloses. The opposite is nearer
 *    the truth: publishing advisories is what a mature security process looks
 *    like, and a count alone would punish it.
 */

import type { Adapter, Company, Fact } from "./types";
import { asObjArr, quote } from "./types";
import { ghHeaders } from "./github";

const GH = "https://api.github.com";

type Advisory = {
  ghsa_id?: string;
  cve_id?: string | null;
  severity?: string;
  published_at?: string;
  html_url?: string;
  summary?: string;
  cvss?: { score?: number | null } | null;
  epss?: { percentage?: number | null } | null;
  vulnerabilities?: { package?: { name?: string; ecosystem?: string } | null }[];
};

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Advisory facts for one artefact.
 *
 * `subject` names what these advisories are ABOUT and is emitted as a fact,
 * because "12 advisories" with no subject is unreadable — a reader cannot tell
 * whether it refers to the company's flagship package or a small utility.
 *
 * No trailing-window counts are computed. Doing so needs the current time,
 * which makes the output non-deterministic for a cached scope and is rejected
 * at prerender anyway. The latest publication date is emitted instead and the
 * reader judges recency, which is also the more honest presentation.
 */
function advisoryFacts(body: unknown, subject: string, subjectLabel: string, sourceUrl: string): Fact[] {
  const rows = asObjArr<Advisory>(body);
  if (rows.length === 0) return [];

  const counts = new Map<string, number>();
  let latest = "";
  let maxCvss: number | null = null;
  const cves: string[] = [];

  for (const a of rows) {
    const sev = (a.severity ?? "").toLowerCase();
    if ((SEVERITIES as readonly string[]).includes(sev)) counts.set(sev, (counts.get(sev) ?? 0) + 1);
    if (a.published_at && a.published_at > latest) latest = a.published_at;
    const score = a.cvss?.score;
    if (typeof score === "number" && (maxCvss === null || score > maxCvss)) maxCvss = score;
    if (a.cve_id) cves.push(a.cve_id);
  }

  const worst = SEVERITIES.find((s) => (counts.get(s) ?? 0) > 0) ?? null;

  const facts: Fact[] = [
    {
      path: "security.advisories.subject",
      value: subject,
      confidence: 1,
      sourceUrl,
      quote: quote(`${rows.length} advisories recorded against ${subjectLabel} ${subject}`),
    },
    { path: "security.advisories.count", value: rows.length, confidence: 1, sourceUrl },
  ];

  for (const s of SEVERITIES) {
    const n = counts.get(s);
    if (n) facts.push({ path: `security.advisories.${s}`, value: n, confidence: 1, sourceUrl });
  }
  if (worst) facts.push({ path: "security.advisories.worst_severity", value: worst, confidence: 1, sourceUrl });
  if (maxCvss !== null) facts.push({ path: "security.advisories.max_cvss", value: maxCvss, confidence: 1, sourceUrl });
  if (latest) {
    facts.push({
      path: "security.advisories.latest",
      value: latest.slice(0, 10),
      confidence: 1,
      sourceUrl,
      quote: quote(`Most recent advisory published ${latest.slice(0, 10)}`),
    });
  }
  // Bounded, so one noisy package cannot write a thousand-character fact.
  if (cves.length) {
    facts.push({ path: "security.advisories.cves", value: cves.slice(0, 12).join(","), confidence: 1, sourceUrl });
  }

  return facts;
}

/**
 * The npm handle, only when it is a real package name.
 *
 * Discovery scrapes `npmjs.com/package/x` and `npmjs.com/org/x` with one
 * pattern, so a bare scope like `@vercel` arrives looking like a package. It
 * is not one, and querying it would silently return nothing forever.
 */
export function npmPackage(c: Company): string | null {
  const raw = c.npm?.trim();
  if (!raw) return null;
  if (raw.startsWith("@") && !raw.includes("/")) return null;
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(raw)) return null;
  return raw;
}

export const SECURITY_ADAPTERS: Adapter[] = [
  {
    kind: "security.advisories.package",
    module: "9. Security",
    label: "GitHub advisories — their published package",
    cadence: "daily",
    tier: "A",
    format: "json",
    /*
     * `affects=<package>` is the evidence. These are advisories filed against
     * a package this company publishes, not against a word that resembles its
     * name.
     */
    url: (c) => {
      const pkg = npmPackage(c);
      return pkg ? `${GH}/advisories?affects=${encodeURIComponent(pkg)}&per_page=100` : null;
    },
    headers: ghHeaders,
    rate: { minIntervalMs: 800 },
    timeoutMs: 12_000,
    extract: (body, ctx) =>
      advisoryFacts(body, npmPackage(ctx.company) ?? "", "the npm package", ctx.url),
  },
  {
    kind: "security.advisories.repo",
    module: "9. Security",
    label: "GitHub advisories — published by them",
    cadence: "daily",
    tier: "A",
    format: "json",
    // Advisories the company itself published for its own repository. The
    // strongest possible provenance: the vendor is the discloser.
    url: (c) => (c.github ? `${GH}/repos/${c.github}/security-advisories?per_page=100` : null),
    headers: ghHeaders,
    rate: { minIntervalMs: 800 },
    timeoutMs: 12_000,
    extract: (body, ctx) => {
      const facts = advisoryFacts(body, ctx.company.github ?? "", "the repository", ctx.url);
      /*
       * Re-pathed so these never merge with the package counts above. They
       * answer a different question — "do they run a disclosure process" —
       * and summing the two would double-count the same CVE.
       */
      return facts.map((f) => ({ ...f, path: f.path.replace("security.advisories.", "security.disclosures.") }));
    },
  },
];
