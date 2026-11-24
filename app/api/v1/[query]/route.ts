/**
 * The REST API. Free, unauthenticated, one named query per path.
 *
 * There is no licence check here any more and no metering: the project is open
 * source and the data is public records, so gating it would only make it less
 * useful without making it more defensible. What remains is the thing that
 * always mattered — fixed, parameterised queries, never arbitrary input
 * reaching a data source.
 *
 * No `export const runtime`: Cache Components is enabled in next.config.ts and
 * rejects it. The Node default is what we want anyway.
 */

import { NextResponse } from "next/server";
import { byName, catalogue } from "@/lib/queries";

export const maxDuration = 300;

/** CORS is open, because an unauthenticated public API that browsers cannot
 *  call from a page is needlessly awkward. Nothing here is credentialed. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-watcher",
} as const;

/**
 * An optional, caller-chosen id used only to scope a watchlist.
 *
 * It is not a credential: it authenticates nothing, grants nothing, and any
 * string works. It exists so a self-hosted deployment can keep more than one
 * watchlist without inventing accounts.
 */
const watcherFrom = (req: Request, body: Record<string, unknown>): string | null => {
  const v = req.headers.get("x-watcher") ?? body.watcher;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null;
};

export async function POST(req: Request, ctx: RouteContext<"/api/v1/[query]">) {
  const { query } = await ctx.params;

  const def = byName(query);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown query "${query}".`, available: catalogue().map((q) => q.name) },
      { status: 404, headers: CORS },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: CORS });
  }

  const result = await def.run(body, { watcher: watcherFrom(req, body) });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: CORS });
  }

  return NextResponse.json({ query: def.name, ...result }, { headers: CORS });
}

/** Discovery, same as the index. */
export async function GET() {
  return NextResponse.json({ queries: catalogue() }, { headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
