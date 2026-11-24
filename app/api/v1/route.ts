/**
 * The API index.
 *
 * `/docs` tells people `GET /api/v1` returns the catalogue, and it did not —
 * only `/api/v1/[query]` had a GET handler, so the documented discovery call
 * returned the 404 page. Discovery must never need a licence, so this is open.
 */

import { NextResponse } from "next/server";
import { QUERIES, catalogue } from "@/lib/queries";
import { FREE_CALLS_PER_DAY } from "@/lib/offer";
import { SITE_NAME, abs } from "@/lib/site";

export async function GET() {
  return NextResponse.json({
    name: `${SITE_NAME} API`,
    docs: abs("/docs"),
    mcp: abs("/api/mcp"),
    skill: abs("/skill/SKILL.md"),
    usage: "POST /api/v1/{query} with a JSON body. Licence key in an Authorization or x-license-key header.",
    metering: {
      free: `${FREE_CALLS_PER_DAY} calls/day without a key; public queries only.`,
      paid: "Unmetered. Plans are priced on companies tracked, not on calls.",
    },
    counts: { total: QUERIES.length, free: QUERIES.filter((q) => q.tier === "public").length },
    queries: catalogue(),
  });
}
