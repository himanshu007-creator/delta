/**
 * Verify every block produces real INTELLIGENCE, not just a 200.
 *
 * Runs each adapter against live companies and prints the facts it actually
 * emits, so each metric can be judged on signal rather than on uptime. A block
 * that returns data but says nothing useful is worse than one that fails, since
 * it looks like it works.
 *
 *   npx tsx scripts/verify-blocks.ts            # all blocks
 *   npx tsx scripts/verify-blocks.ts stack.dns  # one block
 */
import { ADAPTERS, adaptersFor } from "../lib/sources/registry";
import { runAdapter } from "../lib/sources/run";
import type { Company } from "../lib/sources/types";

const COMPANIES: Company[] = [
  { domain: "vercel.com", name: "Vercel", ats: { provider: "greenhouse", token: "vercel" },
    github: "vercel/next.js", npm: "next", wikipedia: "Vercel" },
  { domain: "notion.so", name: "Notion", ats: { provider: "ashby", token: "notion" },
    appStoreId: "1232780281", wikipedia: "Notion_(productivity_software)" },
  { domain: "linear.app", name: "Linear", ats: { provider: "ashby", token: "linear" } },
  { domain: "automattic.com", name: "Automattic", wpSlug: "woocommerce" },
];

const only = process.argv.slice(2);
const fmt = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 88 ? `${s.slice(0, 85)}…` : s;
};

type Row = { kind: string; company: string; status: string; facts: number; ms: number; note: string };

async function main() {
  const rows: Row[] = [];
  const seenOk = new Set<string>();

  for (const c of COMPANIES) {
    const applicable = adaptersFor(c).filter((a) => !only.length || only.includes(a.kind));
    if (!applicable.length) continue;
    console.log(`\n${"═".repeat(76)}\n  ${c.name}  (${c.domain})\n${"═".repeat(76)}`);

    for (const a of applicable) {
      const r = await runAdapter(a, c);
      const note =
        r.status === "ok" ? `${r.facts.length} facts`
        : r.status === "fail" ? `${r.reason}: ${r.detail.slice(0, 60)}`
        : r.status === "skip" ? "n/a"
        : "unchanged";
      rows.push({ kind: a.kind, company: c.domain, status: r.status, facts: r.status === "ok" ? r.facts.length : 0, ms: r.ms, note });

      const mark = r.status === "ok" && r.facts.length ? "✓" : r.status === "ok" ? "∅" : "✗";
      console.log(`\n  ${mark} ${a.kind.padEnd(20)} ${a.module}`);
      console.log(`    ${String(r.ms).padStart(6)}ms  ${note}`);

      if (r.status === "ok") {
        if (r.facts.length) seenOk.add(a.kind);
        // Show the intelligence, not the plumbing.
        for (const f of r.facts.slice(0, 10)) {
          const conf = f.confidence !== undefined && f.confidence < 1 ? ` (conf ${f.confidence})` : "";
          console.log(`      ${f.path.padEnd(34)} = ${fmt(f.value)}${conf}`);
        }
        if (r.facts.length > 10) console.log(`      … ${r.facts.length - 10} more`);
      }
    }
  }

  // --- verdict per block ---------------------------------------------------
  console.log(`\n${"═".repeat(76)}\n  VERDICT — did each block yield intelligence?\n${"═".repeat(76)}`);
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const bad: string[] = [];
  for (const k of kinds) {
    const mine = rows.filter((r) => r.kind === k);
    const ok = mine.filter((r) => r.status === "ok" && r.facts > 0);
    const fails = mine.filter((r) => r.status === "fail");
    const verdict = ok.length ? `OK   ${ok.length}/${mine.filter((m) => m.status !== "skip").length} companies, ${Math.max(...ok.map((o) => o.facts))} facts max` : `WEAK no facts from any company`;
    if (!ok.length) bad.push(k);
    console.log(`  ${ok.length ? "✓" : "✗"} ${k.padEnd(20)} ${verdict}${fails.length ? `  [${fails.length} fail: ${fails[0].note.slice(0, 44)}]` : ""}`);
  }
  console.log(`\n  ${kinds.length - bad.length}/${kinds.length} blocks produce intelligence.`);
  if (bad.length) console.log(`  NEEDS WORK: ${bad.join(", ")}`);
  console.log();
}
main();
