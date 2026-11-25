/**
 * Every page, as Markdown, for agents.
 *
 * An assistant handed an HTML page spends most of its context on markup,
 * navigation and styling before reaching a single fact. Since this product's
 * whole premise is that the data should be usable by machines, every public
 * page also exists as clean Markdown at the same path with `.md` appended:
 *
 *   /c/adyen.com      ->  /c/adyen.com.md
 *   /stack/anthropic  ->  /stack/anthropic.md
 *   /compare/a-vs-b   ->  /compare/a-vs-b.md
 *
 * proxy.ts rewrites the `.md` suffix onto this catch-all, and every HTML page
 * advertises its Markdown twin with `<link rel="alternate">`, so an agent can
 * discover it without being told.
 *
 * The content is generated from the same sources the HTML pages render, so the
 * two cannot drift — and every fact keeps its source URL, because provenance
 * is the point of the product and an agent needs it more than a human does.
 */

import { factsFor } from "@/lib/cached-dossier";
import { correlate } from "@/lib/correlate";
import { coverageOf, coverageSummary, currencySymbol, isCurrencyCode, pricingLadderOf } from "@/lib/profile";
import { footprintOf, identityOf, interpret, bigMoney, financialsOf, securityOf, hasSecurity, workforceOf, hasWorkforce } from "@/lib/interpret";
import { publicDomain } from "@/lib/public-dossier";
import { SEED, comparablePairs, parsePair, seedFor } from "@/lib/seed";
import { isPageworthyVendor, prettyVendor, stackIndex, vendorRow } from "@/lib/stack-index";
import { SITE_NAME } from "@/lib/site";
import { requestOrigin } from "@/lib/origin";
import { countryName } from "@/lib/worldmap";

/*
 * The origin is THREADED through every builder, never stored at module scope.
 *
 * A `let ORIGIN` set at the top of GET looks simpler and is a race: two
 * concurrent requests on different hosts — a custom domain and a preview URL,
 * say — would have the second overwrite the first mid-render, and the first
 * would emit links to the wrong deployment. Module state outlives a request
 * in every serverless runtime, so it cannot hold per-request values.
 */
type Ctx = { origin: string; abs: (path: string) => string };
const ctxFor = (origin: string): Ctx => ({ origin, abs: (p) => `${origin}${p}` });

const md = (body: string) =>
  new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=600, s-maxage=3600",
    },
  });

const missing = () =>
  new Response("# Not found\n\nNo such page.\n", {
    status: 404,
    headers: { "content-type": "text/markdown; charset=utf-8", "x-robots-tag": "noindex" },
  });

/** A footer every document carries, so a quoted answer can cite us. */
const footer = (canonical: string, site: Ctx) =>
  `\n---\n\nSource: ${SITE_NAME} — ${site.abs(canonical)}\n` +
  `Public records only; every fact above links to the page it came from.\n` +
  `Refreshed at 00:00 and 12:00 UTC. Free, unauthenticated API and MCP server: ${site.abs("/docs")}\n`;

export async function GET(_req: Request, routeCtx: RouteContext<"/md/[...path]">) {
  // Absolute links inside a Markdown twin must point at the host the agent
  // actually fetched, or a fork's output sends readers to someone else's copy.
  const site = ctxFor(await requestOrigin());
  const { path } = await routeCtx.params;
  const parts = (path ?? []).map((p) => decodeURIComponent(p));
  const [kind, slug] = parts;

  if (kind === "c" && slug) return company(slug, site);
  if (kind === "c" && !slug) return companyIndex(site);
  if (kind === "stack" && slug) return vendor(slug, site);
  if (kind === "stack" && !slug) return vendorIndex(site);
  if (kind === "compare" && slug) return compare(slug, site);
  if (kind === "compare" && !slug) return compareIndex(site);
  return missing();
}

// --- /c/[domain].md ---------------------------------------------------------

async function company(raw: string, site: Ctx) {
  const domain = publicDomain(raw);
  if (!domain) return missing();

  const { facts, source } = await factsFor(domain);
  if (facts.size === 0) return md(`# ${domain}\n\nNothing readable from public sources.\n`);

  const id = identityOf(facts);
  const fp = footprintOf(facts);
  const signals = interpret(facts);
  const fin = financialsOf(facts);
  const sec = securityOf(facts);
  const work = workforceOf(facts);
  const insights = correlate(facts);
  const coverage = coverageOf(facts);
  const ladder = pricingLadderOf(facts);

  const lines: string[] = [`# ${domain}`, ""];

  // Identity first, and an unresolved entity says so rather than going blank.
  const bits: string[] = [];
  if (id.legalName) bits.push(`**${id.legalName}**`);
  else if (id.candidateName)
    bits.push(
      `Legal entity unconfirmed — the registry holds *${id.candidateName}*` +
        `${id.candidateCountry ? ` (${id.candidateCountry})` : ""} among ${id.candidates ?? "several"} same-name entities`,
    );
  if (id.vat) bits.push(`VAT ${id.vat}`);
  if (id.founded) bits.push(`founded ${id.founded.slice(0, 4)}`);
  if (fp.registered) bits.push(countryName(fp.registered));
  if (bits.length) lines.push(bits.join(" · "), "");

  const h1 = facts.get("positioning.h1")?.value;
  if (h1) lines.push(`> ${h1}`, "");

  /*
   * Coverage first. An agent summarising this page must be able to say what
   * is NOT known, and a page that silently omits empty sections gives it no
   * way to tell "nothing to report" from "we could not read it".
   */
  {
    const sum = coverageSummary(coverage);
    lines.push("## Coverage", "");
    lines.push(
      `${sum.available} of ${sum.total} intelligence areas are fully readable for this company ` +
        `(${sum.partial} partial, ${sum.missing} not available). "Not available" means the public record ` +
        `does not carry it — NOT that the company lacks it.`,
      "",
      "| Area | Status | Why |",
      "|---|---|---|",
    );
    for (const c of coverage) {
      const label = c.status === "available" ? "Available" : c.status === "partial" ? "Partial" : "Not available";
      lines.push(`| ${c.label} | ${label} | ${c.detail}${c.asOf ? ` (as of ${c.asOf})` : ""} |`);
    }
    lines.push("");
  }

  /*
   * The ladder, already normalised to monthly equivalents upstream.
   */
  if (ladder) {
    const sym = currencySymbol(ladder.currency);
    const money = (m: number) => `${sym}${m / 100 % 1 === 0 ? (m / 100).toFixed(0) : (m / 100).toFixed(2)}`;
    lines.push("## Pricing, normalised", "");
    lines.push("| Tier | Monthly equivalent | Basis | Annual saving |", "|---|---|---|---|");
    for (const t of ladder.tiers) {
      lines.push(
        `| ${t.name} | ${t.monthlyMinor !== null ? money(t.monthlyMinor) : "—"} | ` +
          `${t.perSeat ? "per seat" : t.monthlyMinor !== null ? "flat" : "contact sales"} | ` +
          `${t.annualDiscountPct !== null ? `${t.annualDiscountPct}%` : "—"} |`,
      );
    }
    lines.push(
      "",
      `Monthly equivalents${isCurrencyCode(ladder.currency) ? ` in ${ladder.currency}` : ""}, so annually-billed and monthly-billed tiers compare ` +
        `directly. Contact-sales tiers carry no number because none is published. Currency is what the ` +
        `page served us and can depend on where the read originated.`,
      "",
    );
  }

  /*
   * Cross-source patterns.  /*
   * Cross-source patterns. Written so an agent summarising this page cannot
   * quote the claim without the counter-reading: both are in the same block.
   */
  if (insights.length) {
    lines.push("## Patterns across sources", "");
    lines.push(
      "Each pattern below combines observations from at least two independent sources. They are " +
        "co-occurrences, NOT causes, and every one carries its alternative reading. Do not report a " +
        "pattern without it.",
      "",
    );
    for (const i of insights) {
      lines.push(`### ${i.headline}`, "");
      lines.push(`*Pattern strength: ${i.strength}.* ${i.soWhat}`, "");
      for (const e of i.evidence) {
        lines.push(`- ${e.label}: ${e.value}${e.source ? ` — ${e.source}` : ""}`);
      }
      lines.push("");
      lines.push(`**Could also be:** ${i.alternative}`, "");
      lines.push(`**Limitation:** ${i.limitation}`, "");
    }
  }

  /*
   * Hiring. The split is the signal  /*
   * Hiring. The split is the signal; the headcount of open roles is not.
   * An agent summarising this needs the caveat as much as the numbers.
   */
  if (hasWorkforce(work)) {
    const total = work.functions.reduce((n, x) => n + x.count, 0) + work.unclassified;
    lines.push("## Hiring", "");
    lines.push(
      `**${work.openRoles}** open roles on their own job board` +
        `${work.focus ? `, concentrated in ${work.focus}` : ""}.`,
      "",
    );
    if (work.functions.length) {
      lines.push("| Function | Open roles |", "|---|---|");
      for (const x of work.functions) lines.push(`| ${x.name} | ${x.count} |`);
      if (work.unclassified) lines.push(`| unclassified | ${work.unclassified} |`);
      lines.push("");
    }
    if (work.seniority.length) {
      lines.push(
        `Seniority named in the title: ${work.seniority.map((x) => `${x.count} ${x.name}`).join(", ")}.` +
          `${work.remote ? ` ${work.remote} postings name a remote location.` : ""}`,
        "",
      );
    }
    lines.push(
      `Functions are inferred from each posting's title and team, so they are a judgement rather than a ` +
        `filing${total ? ` — ${work.unclassified} of ${total} could not be placed` : ""}. A posting ` +
        `disappearing is NOT evidence of a layoff: boards drop and re-add roles constantly, and a removed ` +
        `posting is also what a filled role looks like.`,
      "",
    );
  }

  /*
   * Insolvency. Only ever about the registered entity, and a zero is a
   * finding rather than a blank.
   */
  const insolvency = facts.get("legal.insolvency.notices")?.value;
  if (insolvency !== undefined && insolvency !== null) {
    const n = Number(insolvency);
    lines.push("## Legal: insolvency register", "");
    lines.push(
      n > 0
        ? `**${n}** insolvency notice(s) in The Gazette name this registered entity in the notice title.`
        : `No insolvency notice in The Gazette names this registered entity.`,
      "",
      "Searched against the registered legal name. A notice counts only when it names the company itself — " +
        "searching a bare brand returns notices about entirely different companies.",
      "",
    );
  }

  /*
   * Security exposure.  /*
   * Security exposure. Scoped to artefacts they own, and the two advisory
   * feeds are reported separately because the same CVE appears in both.
   */
  if (hasSecurity(sec)) {
    lines.push("## Security, publicly disclosed", "");
    if (sec.count !== null && sec.subject) {
      lines.push(
        `**${sec.count}** public advisories are recorded against \`${sec.subject}\`, a package they publish` +
          `${sec.bySeverity.length ? ` — ${sec.bySeverity.map((x) => `${x.count} ${x.severity}`).join(", ")}` : ""}.` +
          `${sec.latest ? ` Most recent: ${sec.latest}.` : ""}`,
        "",
        "An advisory describes a version range and usually ships with its fix. This is a record of " +
          "disclosure, not a claim that the package is unsafe today.",
        "",
      );
    }
    if (sec.disclosed !== null) {
      lines.push(
        `They have published **${sec.disclosed}** advisories themselves for \`${sec.disclosedSubject}\`` +
          `${sec.disclosedLatest ? `, most recently ${sec.disclosedLatest}` : ""}. Counted separately: the ` +
          `same CVEs appear in both feeds, so these must not be added together.`,
        "",
      );
    }
    if (sec.scorecard !== null) lines.push(`OpenSSF Scorecard: ${sec.scorecard}/10.`, "");
    lines.push(
      "Scope: only advisories filed against packages and repositories this company owns. Vulnerability " +
        "feeds are never matched on a company name — that returns hundreds of unrelated products.",
      "",
    );
  }

  /*
   * Financials, stated as filed. An agent reading this needs the same three
   * states a person does: figures, an unresolved filer, or not a filer — and
   * the last two must not look like missing data.
   */
  if (fin.figures.length) {
    lines.push("## Financials, as filed", "");
    if (fin.registrant && fin.cik) {
      lines.push(
        `Filed by **${fin.registrant}** (SEC CIK ${fin.cik}), identified because ` +
          `${fin.filingsMatched ?? "its"} annual report(s) contain \`${domain}\` — not by name match.`,
        "",
      );
    }
    lines.push("| Figure | Amount | Year ended | Form | Filed | YoY |", "|---|---|---|---|---|---|");
    for (const x of fin.figures.filter((y) => !y.stale)) {
      lines.push(
        `| ${x.label} | ${bigMoney(x.value, x.unit)} | ${x.periodEnd ?? "—"} | ${x.form ?? "—"} | ` +
          `${x.filed ?? "—"} | ${x.yoyPct === null ? "—" : `${x.yoyPct >= 0 ? "+" : ""}${x.yoyPct}%`} |`,
      );
    }
    /*
     * Stale figures go BELOW the table with their own warning, so an agent
     * summarising this cannot compute a margin across two different years.
     */
    const stale = fin.figures.filter((y) => y.stale);
    if (stale.length) {
      lines.push(
        "",
        "**Not comparable with the table above** — these are the company's last filed values for " +
          "lines it no longer reports under the same tag:",
        "",
      );
      for (const x of stale) {
        lines.push(`- ${x.label}: ${bigMoney(x.value, x.unit)} (year ended ${x.periodEnd ?? "unknown"})`);
      }
      lines.push("");
    }
    lines.push("", "Exact values and source URLs are in the fact table below.", "");
  } else if (fin.unresolvedCandidates) {
    lines.push(
      "## Financials, as filed",
      "",
      `Not resolved. Several filers mention \`${domain}\` and none is identifiable as its filer ` +
        `(${fin.unresolvedCandidates}). No figures are attached, because a domain is often named by the ` +
        `companies that merely use it.`,
      "",
    );
  } else if (!fin.checked) {
    lines.push(
      "## Financials, as filed",
      "",
      source === "store"
        ? `Unknown. The recorded history for \`${domain}\` was collected before this deployment started ` +
          `checking filings, so it holds no answer either way. NOT a statement that the company is private.`
        : `Unknown. The SEC filing index did not answer for \`${domain}\` on this read, so we cannot say ` +
          `whether it files. This is a gap in our read, NOT a statement that the company is private.`,
      "",
    );
  } else if (fin.cik) {
    lines.push(
      "## Financials, as filed",
      "",
      `\`${domain}\` files with the SEC as CIK ${fin.cik}` +
        `${fin.registrant ? ` (${fin.registrant})` : ""}, but no figures came back on this read.`,
      "",
    );
  } else {
    lines.push(
      "## Financials, as filed",
      "",
      `None. No US annual report names \`${domain}\`, which is the normal case for a private company. ` +
        `Revenue is published only where a regulator-filed document supports it; there are no estimates ` +
        `here, and funding is never reported as revenue.`,
      "",
    );
  }

  if (fp.registered || fp.markets.length) {
    lines.push("## Where they are", "");
    if (fp.registered) {
      lines.push(`- Registered: ${countryName(fp.registered)}${fp.basis ? ` (from ${fp.basis})` : ""}`);
    }
    if (fp.city) lines.push(`- City: ${fp.city}`);
    if (fp.markets.length) {
      lines.push(
        `- Markets published: ${fp.markets.map(countryName).join(", ")}`,
        "  (inferred from region-bearing locales — evidence of where they sell, not of an office)",
      );
    }
    lines.push("");
  }

  if (signals.length) {
    lines.push("## What matters", "");
    for (const s of signals) {
      lines.push(`### ${s.label}: ${s.headline}`, "", s.meaning);
      if (s.sourceUrl) lines.push(`Source: ${s.sourceUrl}`);
      lines.push("");
    }
  }

  lines.push("## Every fact", "", "| Fact | Value | Confidence | Source |", "|---|---|---|---|");
  for (const [p, f] of [...facts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const v = (f.value ?? "—").replace(/\|/g, "\\|").slice(0, 160);
    const c = typeof f.confidence === "number" ? `${Math.round(f.confidence * 100)}%` : "—";
    lines.push(`| \`${p}\` | ${v} | ${c} | ${f.sourceUrl ?? "—"} |`);
  }
  lines.push("");
  lines.push(
    source === "store"
      ? "_From our index, refreshed twice daily._"
      : "_Read live from public sources on request; this company is not tracked yet._",
  );
  lines.push(footer(`/c/${domain}`, site));

  return md(lines.join("\n"));
}

function companyIndex(site: Ctx) {
  const ix = stackIndex();
  const vendorCount = new Map(ix.entries.map((e) => [e.domain, e.vendors.length]));
  const byCat = new Map<string, typeof SEED[number][]>();
  for (const c of SEED) {
    const l = byCat.get(c.category) ?? [];
    l.push(c);
    byCat.set(c.category, l);
  }
  const lines = [
    "# Every company tracked",
    "",
    `${SEED.length} companies across ${byCat.size} markets, refreshed at 00:00 and 12:00 UTC.`,
    "",
  ];
  for (const [cat, list] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${cat} (${list.length})`, "", "| Company | Domain | Vendors | Page |", "|---|---|---|---|");
    for (const c of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| ${c.name} | ${c.domain} | ${vendorCount.get(c.domain) ?? 0} | ${site.abs(`/c/${c.domain}`)} |`);
    }
    lines.push("");
  }
  lines.push(footer("/c", site));
  return md(lines.join("\n"));
}

// --- /stack/[vendor].md -----------------------------------------------------

function vendor(raw: string, site: Ctx) {
  const slug = raw.toLowerCase();
  const row = vendorRow(slug);
  if (!row || !isPageworthyVendor(slug)) return missing();

  const ix = stackIndex();
  const label = prettyVendor(row.vendor);
  const lines = [
    `# Companies using ${label}`,
    "",
    `${row.domains.length} of ${ix.domainsIndexed} indexed companies publish a DNS verification record for ${label}.`,
    "",
    "A verification record proves a relationship with the vendor, not its size or price.",
    "These are back-office purchases that frontend script detection cannot see.",
    "",
    "## Adopters",
    "",
    ...row.domains.map((d) => `- ${d} — ${site.abs(`/c/${d}`)}`),
    "",
    footer(`/stack/${slug}`, site),
  ];
  return md(lines.join("\n"));
}

function vendorIndex(site: Ctx) {
  const ix = stackIndex();
  const rows = ix.vendors
    .filter((v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor))
    .sort((a, b) => b.domains.length - a.domains.length);
  const lines = [
    "# Vendor adoption",
    "",
    `${rows.length} vendors across ${ix.domainsIndexed} indexed companies, from public DNS records.`,
    "",
    "| Vendor | Companies | Page |",
    "|---|---|---|",
    ...rows.map((v) => `| ${prettyVendor(v.vendor)} | ${v.domains.length} | ${site.abs(`/stack/${v.vendor}`)} |`),
    "",
    footer("/stack", site),
  ];
  return md(lines.join("\n"));
}

function compareIndex(site: Ctx) {
  const pairs = comparablePairs();
  const byCategory = new Map<string, typeof pairs>();
  for (const p of pairs) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  const lines = [
    "# Head-to-head comparisons",
    "",
    `${pairs.length} comparisons, generated only within a category — "gymshark vs hashicorp" is not a question anyone asks.`,
    "",
  ];
  for (const [cat, list] of [...byCategory].sort()) {
    lines.push(`## ${cat} (${list.length})`, "");
    for (const p of list.slice(0, 40)) {
      lines.push(`- ${seedFor(p.a)?.name ?? p.a} vs ${seedFor(p.b)?.name ?? p.b} — ${site.abs(`/compare/${p.slug}`)}`);
    }
    if (list.length > 40) lines.push(`- …and ${list.length - 40} more in this category.`);
    lines.push("");
  }
  lines.push(footer("/compare", site));
  return md(lines.join("\n"));
}

// --- /compare/[pair].md -----------------------------------------------------

async function compare(raw: string, site: Ctx) {
  const parsed = parsePair(raw.toLowerCase());
  if (!parsed) return missing();
  const { a, b } = parsed;

  const [fa, fb] = await Promise.all([factsFor(a), factsFor(b)]);
  const nameA = seedFor(a)?.name ?? a;
  const nameB = seedFor(b)?.name ?? b;

  const paths = [...new Set([...fa.facts.keys(), ...fb.facts.keys()])].sort();
  const rows = paths
    .map((p) => ({ p, av: fa.facts.get(p)?.value ?? null, bv: fb.facts.get(p)?.value ?? null }))
    // Only differences: a table of identical rows is not a comparison.
    .filter((r) => r.av !== r.bv);

  const lines = [
    `# ${nameA} vs ${nameB}`,
    "",
    `Current state, side by side. ${rows.length} of ${paths.length} recorded facts differ.`,
    "",
    `| Fact | ${nameA} | ${nameB} |`,
    "|---|---|---|",
    ...rows.map(
      (r) =>
        `| \`${r.p}\` | ${(r.av ?? "—").replace(/\|/g, "\\|").slice(0, 110)} | ${(r.bv ?? "—").replace(/\|/g, "\\|").slice(0, 110)} |`,
    ),
    "",
    `Full dossiers: ${site.abs(`/c/${a}`)} · ${site.abs(`/c/${b}`)}`,
    "",
    "This is today's snapshot. What moves a decision is which of them is CHANGING —",
    `and that history only exists where a deployment has been watching: ${site.origin}/docs`,
    footer(`/compare/${raw.toLowerCase()}`, site),
  ];
  return md(lines.join("\n"));
}
