/**
 * Precompute the dotted world map, once, at build time.
 *
 * `dotted-map` carries ~700KB of geography to work out which dots are land.
 * That belongs in a build step, not in a page bundle — so this writes the
 * resulting point list to JSON and the app renders it with
 * `dotted-map/without-countries`, which has no geo data in it at all.
 *
 * Deliberately the whole landmass with NO country selection, so the output has
 * no borders in it. Borders are disputed; a coastline sampled to dots is not,
 * and for "this company is registered here" a border adds nothing anyway.
 *
 * Run: npx tsx scripts/build-dotmap.ts
 */

import { writeFileSync } from "node:fs";
import { getMapJSON } from "dotted-map";

// Antarctica is cut off: no company is registered there, and including it
// spends a fifth of the map's height on ice.
const json = getMapJSON({
  height: 54,
  grid: "diagonal",
  region: { lat: { min: -58, max: 79 }, lng: { min: -180, max: 180 } },
});

const out = "lib/dotmap.generated.json";
writeFileSync(out, json);

const parsed = JSON.parse(json) as { points?: unknown[] };
console.log(
  `${out}: ${(json.length / 1024).toFixed(0)}KB, ${Object.keys(parsed.points ?? {}).length} land dots`,
);
