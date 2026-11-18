/**
 * Seed the store: insert the companies and register their surfaces.
 *
 *   npx tsx scripts/seed-store.ts
 *
 * Idempotent — `upsert_company` merges handles rather than replacing them, and
 * `register_surfaces` is on-conflict-do-nothing. Safe to re-run after adding
 * adapters or seed companies.
 */

import { SEED } from "../lib/seed";
import { adaptersFor } from "../lib/sources/registry";
import { registerSurfaces, storeConfigured, upsertCompany } from "../lib/store";

async function main() {
  if (!storeConfigured()) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (try: vercel env pull .env.local)");
    process.exit(1);
  }

  let companies = 0, surfaces = 0, failures = 0;

  for (const s of SEED) {
    const up = await upsertCompany({
      domain: s.domain, name: s.name, category: s.category, requestedBy: "seed",
    });
    if (!up.ok) { console.error(`  ${s.domain}: ${up.error}`); failures++; continue; }
    companies++;

    // Only the adapters that actually apply: a company with no repo should not
    // carry ten GitHub surfaces that can never succeed.
    const applicable = adaptersFor({ domain: s.domain, name: s.name });
    const reg = await registerSurfaces(
      s.domain,
      applicable.map((a) => a.kind),
      applicable.map((a) => a.cadence),
    );
    if (!reg.ok) { console.error(`  ${s.domain} surfaces: ${reg.error}`); failures++; continue; }
    surfaces += Number(reg.data ?? 0);
    process.stdout.write(`\r  ${companies}/${SEED.length} companies, ${surfaces} surfaces registered`);
  }

  console.log(`\n\nseeded ${companies} companies, ${surfaces} new surfaces, ${failures} failures`);
  console.log("next: trigger a window →  curl -s localhost:3000/api/cron/window | jq");
}

main();
