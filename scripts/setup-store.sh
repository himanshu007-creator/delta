#!/usr/bin/env bash
# One command to fill the store from empty.
#
#   bash scripts/setup-store.sh
#
# Assumes: the schema has been run in the Supabase SQL editor, and
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are in .env.local
# (npx vercel env pull .env.local).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "no .env.local — run: npx vercel env pull .env.local" >&2
  exit 1
fi
# Export the two the store needs, ignoring comments and blank lines.
set -a; . ./.env.local; set +a

echo "==> 1/3  seeding companies and surfaces"
npx tsx scripts/seed-store.ts

echo
echo "==> 2/3  running the first crawl window (this takes a while — ~40 sources per company)"
npx tsx scripts/crawl-once.ts

echo
echo "==> 3/3  verifying"
npx tsx -e '
import { companyChanges, companyFacts, crawlStats } from "./lib/store";
(async () => {
  const s = await crawlStats();
  if (s.ok && s.data?.[0]) console.log("  stats:", s.data[0]);
  const f = await companyFacts("linear.app");
  if (f.ok) console.log(`  linear.app: ${f.data?.length ?? 0} facts stored`);
  const c = await companyChanges("linear.app", 5);
  if (c.ok) console.log(`  linear.app: ${c.data?.length ?? 0} changes recorded (0 is correct on a first crawl)`);
})();'
