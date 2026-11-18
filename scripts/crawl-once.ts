/**
 * Run a crawl window directly, without HTTP.
 *
 *   npx tsx scripts/crawl-once.ts            # drain the whole window
 *   npx tsx scripts/crawl-once.ts 40         # one batch of 40
 *
 * The /api/cron/window endpoint exists for the scheduled trigger, but it needs
 * a running server and self-chains over HTTP — awkward for the first fill and
 * for local debugging. This drives the same store functions in-process, so the
 * first crawl is one command and failures surface in the terminal rather than
 * in a server log.
 *
 * Identical semantics: the same atomic SQL claim, the same unchanged fast path,
 * the same per-surface failure handling. Safe to interrupt and re-run — claimed
 * surfaces simply become due again next window.
 */

import { byKind } from "../lib/sources/registry";
import { runAdapter } from "../lib/sources/run";
import type { Company } from "../lib/sources/types";
import {
  claimSurfaces, crawlStats, currentWindow, recordFailure, recordSurface,
  recordUnchanged, storeConfigured,
} from "../lib/store";

const BATCH = 40;
const CONCURRENCY = 6;

async function pooled<T>(items: readonly T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    }),
  );
}

async function main() {
  if (!storeConfigured()) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
    console.error("  npx vercel env pull .env.local");
    process.exit(1);
  }

  const onlyOneBatch = process.argv[2] !== undefined;
  const windowAt = currentWindow();
  console.log(`window ${windowAt.toISOString()}  (batch ${BATCH}, concurrency ${CONCURRENCY})\n`);

  const before = await crawlStats();
  if (before.ok && before.data?.[0]) {
    const s = before.data[0];
    console.log(`before: ${s.companies} companies, ${s.surfaces} surfaces, ${s.facts} facts, ${s.changes} changes, ${s.due} due\n`);
  }

  let round = 0;
  const total = { ok: 0, unchanged: 0, failed: 0, skipped: 0, changes: 0 };
  const reasons = new Map<string, number>();

  for (;;) {
    const claimed = await claimSurfaces(windowAt, Number(process.argv[2]) || BATCH);
    if (!claimed.ok) { console.error(`\nclaim failed: ${claimed.error}`); process.exit(1); }
    const batch = claimed.data ?? [];
    if (!batch.length) { console.log("\nnothing left due — window complete"); break; }

    round++;
    await pooled(batch, CONCURRENCY, async (s) => {
      const adapter = byKind(s.kind);
      if (!adapter) {
        total.failed++;
        await recordFailure(s.company_domain, s.kind, "no such adapter");
        return;
      }
      const company: Company = {
        ...((s.handles ?? {}) as Partial<Company>),
        domain: s.company_domain,
        name: s.name ?? undefined,
      };
      const r = await runAdapter(adapter, company, { lastHash: s.last_hash });

      if (r.status === "unchanged") { total.unchanged++; await recordUnchanged(s.company_domain, s.kind); return; }
      if (r.status === "skip") { total.skipped++; await recordFailure(s.company_domain, s.kind, "not-applicable"); return; }
      if (r.status === "fail") {
        total.failed++;
        reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
        await recordFailure(s.company_domain, s.kind, r.reason);
        return;
      }
      const written = await recordSurface(s.company_domain, s.kind, r.hash, r.facts);
      if (written.ok) { total.ok++; total.changes += Number(written.data ?? 0); }
      else { total.failed++; reasons.set("store-write", (reasons.get("store-write") ?? 0) + 1); }
    });

    process.stdout.write(
      `\rround ${round}: ${total.ok} ok · ${total.unchanged} unchanged · ${total.failed} failed · ` +
      `${total.skipped} n/a · ${total.changes} changes recorded`,
    );
    if (onlyOneBatch) break;
  }

  console.log("\n");
  if (reasons.size) {
    console.log("failure reasons:");
    for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);
    console.log();
  }

  const after = await crawlStats();
  if (after.ok && after.data?.[0]) {
    const s = after.data[0];
    console.log(`after: ${s.companies} companies, ${s.surfaces} surfaces, ${s.facts} facts, ${s.changes} changes, ${s.due} due`);
  }
}

main();
