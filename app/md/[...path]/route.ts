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
import { footprintOf, identityOf, interpret } from "@/lib/interpret";
import { publicDomain } from "@/lib/public-dossier";
import { SEED, comparablePairs, parsePair, seedFor } from "@/lib/seed";
import { isPageworthyVendor, prettyVendor, stackIndex, vendorRow } from "@/lib/stack-index";
import { SITE_NAME, SITE_URL, abs } from "@/lib/site";
import { countryName } from "@/lib/worldmap";

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
const footer = (canonical: string) =>
  `\n---\n\nSource: ${SITE_NAME} — ${abs(canonical)}\n` +
  `Public records only; every fact above links to the page it came from.\n` +
  `Refreshed at 00:00 and 12:00 UTC. Full API and MCP server: ${abs("/#pricing")}\n`;

export async function GET(_req: Request, ctx: RouteContext<"/md/[...path]">) {
  const { path } = await ctx.params;
  const parts = (path ?? []).map((p) => decodeURIComponent(p));
  const [kind, slug] = parts;

  if (kind === "c" && slug) return company(slug);
  if (kind === "c" && !slug) return companyIndex();
  if (kind === "stack" && slug) return vendor(slug);
  if (kind === "stack" && !slug) return vendorIndex();
  if (kind === "compare" && slug) return compare(slug);
  if (kind === "compare" && !slug) return compareIndex();
  return missing();
}

// --- /c/[domain].md ---------------------------------------------------------

async function company(raw: string) {
  const domain = publicDomain(raw);
  if (!domain) return missing();

  const { facts, source } = await factsFor(domain);
  if (facts.size === 0) return md(`# ${domain}\n\nNothing readable from public sources.\n`);

  const id = identityOf(facts);
  const fp = footprintOf(facts);
  const signals = interpret(facts);

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
  lines.push(footer(`/c/${domain}`));

  return md(lines.join("\n"));
}

function companyIndex() {
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
      lines.push(`| ${c.name} | ${c.domain} | ${vendorCount.get(c.domain) ?? 0} | ${abs(`/c/${c.domain}`)} |`);
    }
    lines.push("");
  }
  lines.push(footer("/c"));
  return md(lines.join("\n"));
}

// --- /stack/[vendor].md -----------------------------------------------------

function vendor(raw: string) {
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
    ...row.domains.map((d) => `- ${d} — ${abs(`/c/${d}`)}`),
    "",
    footer(`/stack/${slug}`),
  ];
  return md(lines.join("\n"));
}

function vendorIndex() {
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
    ...rows.map((v) => `| ${prettyVendor(v.vendor)} | ${v.domains.length} | ${abs(`/stack/${v.vendor}`)} |`),
    "",
    footer("/stack"),
  ];
  return md(lines.join("\n"));
}

function compareIndex() {
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
      lines.push(`- ${seedFor(p.a)?.name ?? p.a} vs ${seedFor(p.b)?.name ?? p.b} — ${abs(`/compare/${p.slug}`)}`);
    }
    if (list.length > 40) lines.push(`- …and ${list.length - 40} more in this category.`);
    lines.push("");
  }
  lines.push(footer("/compare"));
  return md(lines.join("\n"));
}

// --- /compare/[pair].md -----------------------------------------------------

async function compare(raw: string) {
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
    `Full dossiers: ${abs(`/c/${a}`)} · ${abs(`/c/${b}`)}`,
    "",
    "This is today's snapshot. What moves a decision is which of them is CHANGING —",
    `that history is the paid product: ${SITE_URL}/#pricing`,
    footer(`/compare/${raw.toLowerCase()}`),
  ];
  return md(lines.join("\n"));
}
