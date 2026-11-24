/**
 * The API index.
 *
 * `/docs` tells people `GET /api/v1` returns the catalogue, and it did not —
 * only `/api/v1/[query]` had a GET handler, so the documented discovery call
 * returned the 404 page. Discovery must never need a licence, so this is open.
 */

import { NextResponse } from "next/server";
import { QUERIES, catalogue } from "@/lib/queries";
import { SITE_NAME, abs } from "@/lib/site";

export async function GET() {
  return NextResponse.json({
    name: `${SITE_NAME} API`,
    docs: abs("/docs"),
    mcp: abs("/api/mcp"),
    skill: abs("/skill/SKILL.md"),
    usage: "POST /api/v1/{query} with a JSON body. No key, no quota.",
    auth: "None. This API is free and unauthenticated; the data is public records.",
    counts: {
      total: QUERIES.length,
      live: QUERIES.filter((q) => q.tier === "live").length,
      needsStore: QUERIES.filter((q) => q.tier === "stored").length,
    },
    queries: catalogue(),
  });
}
