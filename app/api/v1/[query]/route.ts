/**
 * The metered API — and the only enforceable chokepoint in the product.
 *
 * Client-side code cannot be gated, so this route is where a licence turns into
 * value. Two rules, both asserted by lib/license.test.ts:
 *
 *  1. The licence is CHARGED BEFORE THE WORK. Charging afterwards lets a flood
 *     of concurrent requests all read the same stale count and slip through.
 *  2. An unlicensed request gets 402, never 200 with empty data.
 *
 * No `export const runtime` here: Cache Components is enabled in
 * next.config.ts and rejects it. The Node default is what we want anyway.
 */

import { NextResponse } from "next/server";
import { useLicense } from "@/lib/license";
import { byName, catalogue } from "@/lib/queries";

export const maxDuration = 300;

/** Licence key from a header, or the body. Never from a query string — those
 *  end up in logs, proxies and browser history. */
function keyFrom(req: Request, body: Record<string, unknown>): unknown {
  return (
    req.headers.get("x-license-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    body.licenseKey
  );
}

export async function POST(req: Request, ctx: RouteContext<"/api/v1/[query]">) {
  const { query } = await ctx.params;

  const def = byName(query);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown query "${query}".`, available: catalogue().map((q) => q.name) },
      { status: 404 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // (1) CHARGE FIRST. Everything below this line costs us money or goodwill.
  const license = await useLicense(keyFrom(req, body), def.units);
  if (!license.ok) {
    // OUR fault, not theirs: a misconfigured deploy must never read as
    // "you haven't paid", or a bad env var looks like a billing problem.
    if (license.reason === "unconfigured") {
      return NextResponse.json(
        { error: "Licensing isn't configured on this deployment.", reason: license.reason },
        { status: 503 },
      );
    }
    const why = license.reason === "shape"
      ? "That licence key doesn't look right."
      : "That licence key isn't recognised, or has been revoked.";
    return NextResponse.json(
      { error: why, reason: license.reason, remedy: "/#pricing" },
      { status: 402 },
    );
  }

  const result = await runQuery(def, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    query: def.name,
    ...result,
    meta: { ...result.meta, unitsUsed: license.rowsUsed },
  });
}

/** Kept as a named function so the ordering rule above is checkable in tests. */
async function runQuery(def: NonNullable<ReturnType<typeof byName>>, body: Record<string, unknown>) {
  return def.run(body);
}

/** The catalogue is public: discovery must not need a licence. */
export async function GET() {
  return NextResponse.json({ queries: catalogue() });
}
