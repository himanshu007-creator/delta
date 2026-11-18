/**
 * Precompute the vendor index into a committed JSON file.
 *
 *   npx tsx scripts/build-stack-index.ts
 *
 * Why precomputed rather than built per request: DNS TXT is fast when warm
 * (~94ms sequential, measured) but degrades badly under concurrency — 24
 * parallel lookups took 9.9s, and the full seed set took 138s. That is fine for
 * a script and unacceptable for a page render, even a cached one, because the
 * first visitor pays all of it.
 *
 * So the pages read a static file and are instant. Refresh by re-running this;
 * once the crawl cron exists it writes the same shape to the store instead.
 */

import { writeFileSync } from "node:fs";
import { buildStackIndex, isPageworthyVendor, SEED_DOMAINS } from "../lib/stack-index";

const OUT = new URL("../lib/stack-index.generated.json", import.meta.url);
// A separate, tiny file of just the slugs. The proxy imports THIS, not the 79KB
// index, so edge validation stays cheap on every request.
const SLUGS_OUT = new URL("../lib/stack-vendors.generated.json", import.meta.url);

async function main() {
  console.log(`Resolving DNS TXT for ${SEED_DOMAINS.length} domains…`);
  const t0 = Date.now();
  const ix = await buildStackIndex();

  const payload = {
    generatedAt: new Date().toISOString(),
    domainsAttempted: SEED_DOMAINS.length,
    domainsIndexed: ix.domainsIndexed,
    vendors: ix.byVendor,
    entries: ix.entries,
  };

  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);

  const slugs = ix.byVendor
    .filter((v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor))
    .map((v) => v.vendor)
    .sort();
  writeFileSync(SLUGS_OUT, `${JSON.stringify(slugs)}\n`);
  console.log(`  allowlist: ${slugs.length} vendor pages (${Math.round(JSON.stringify(slugs).length / 1024)}KB)`);
  const kb = Math.round(JSON.stringify(payload).length / 1024);

  console.log(
    `\n${ix.domainsIndexed}/${SEED_DOMAINS.length} domains -> ${ix.byVendor.length} vendors ` +
    `in ${((Date.now() - t0) / 1000).toFixed(1)}s (${kb}KB)`,
  );
  for (const r of ix.byVendor.slice(0, 8)) {
    console.log(`  ${String(r.domains.length).padStart(3)}  ${r.vendor}`);
  }
}

main();
