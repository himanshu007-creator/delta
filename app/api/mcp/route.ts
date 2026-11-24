/**
 * The MCP server — Streamable HTTP, one tool per named query.
 *
 * No authentication, no key, no metering. The data is public records and the
 * project is open source, so a gate would cost every agent that might use this
 * and buy nothing in return. An agent firing twenty queries to answer one
 * question is the whole point.
 *
 * The only thing a tool can refuse for is a missing optional history store,
 * and it says exactly that.
 *
 * ponytail: the JSON-RPC subset is implemented here rather than pulling in
 * @modelcontextprotocol/sdk. A stateless tools-only server needs initialize,
 * tools/list, tools/call and ping — about eighty lines — and the SDK's
 * transports expect Node req/res objects that a Next route handler does not
 * hand out. Add the SDK if we ever need sessions, resources or sampling.
 *
 * No `export const runtime`: Cache Components is on and rejects it.
 */

import { QUERIES, byName } from "@/lib/queries";
import { SITE_NAME } from "@/lib/site";
import { requestOrigin } from "@/lib/origin";

export const maxDuration = 300;

/** Protocol revisions this server knows how to speak. */
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST = SUPPORTED[0];

/**
 * CORS. MCP clients include browser-based ones, and `mcp-session-id` has to be
 * exposed or a client that does use sessions cannot read it back.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-watcher, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
} as const;

type RpcId = string | number | null;

const ok = (id: RpcId, result: unknown) =>
  Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS });

const err = (id: RpcId, code: number, message: string, data?: unknown) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }, { headers: CORS });

/** JSON Schema for a query's parameters, built from the registry. */
function schemaFor(q: (typeof QUERIES)[number]) {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const p of q.params) {
    properties[p.name] = { type: p.type, description: p.describe };
  }
  return {
    type: "object",
    properties,
    required: q.params.filter((p) => p.required).map((p) => p.name),
    additionalProperties: false,
  };
}

function toolsList() {
  return {
    tools: QUERIES.map((q) => ({
      name: q.name,
      // The tier is in the description on purpose: an agent that knows a tool
      // needs a key can say so to its user instead of retrying blindly.
      description:
        q.describe +
        (q.tier === "stored" ? " Needs the optional history store." : ""),
      inputSchema: schemaFor(q),
    })),
  };
}

/**
 * An optional, caller-chosen id used only to scope a watchlist. Not a
 * credential: it authenticates nothing and any string works.
 */
const watcherFrom = (req: Request): string | null => {
  const v = req.headers.get("x-watcher");
  return v && v.trim() ? v.trim().slice(0, 120) : null;
};

/** A tool result. `isError` is how MCP reports a failure the model should see. */
const content = (payload: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  isError,
});

async function callTool(req: Request, params: Record<string, unknown>) {
  const name = typeof params.name === "string" ? params.name : "";
  const args = (params.arguments as Record<string, unknown>) ?? {};

  const def = byName(name);
  if (!def) {
    return content(
      { error: `Unknown tool "${name}".`, available: QUERIES.map((q) => q.name) },
      true,
    );
  }

  const result = await def.run(args, { watcher: watcherFrom(req) });
  if (!result.ok) return content({ error: result.error }, true);

  return content({
    query: def.name,
    data: result.data,
    meta: {
      ...result.meta,
      // Provenance travels with the answer, so a model quoting this can say
      // where it came from and how fresh it is.
      refresh: "00:00 and 12:00 UTC",
      note: "Every fact carries its source URL. Do not state a value without it.",
    },
  });
}

export async function POST(req: Request) {
  let msg: Record<string, unknown>;
  try {
    msg = (await req.json()) as Record<string, unknown>;
  } catch {
    return err(null, -32700, "Parse error: body is not valid JSON.");
  }

  // Batches are legal JSON-RPC. Handled by recursion rather than refused,
  // because a client that sends one gets a confusing hang otherwise.
  if (Array.isArray(msg)) {
    return err(null, -32600, "Batched requests are not supported; send one message per request.");
  }

  const id = (msg.id ?? null) as RpcId;
  const method = typeof msg.method === "string" ? msg.method : "";
  const params = (msg.params as Record<string, unknown>) ?? {};

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      // Self-report the endpoint the client actually reached, so an agent can
      // quote a working URL on a fork or a custom domain.
      const origin = await requestOrigin();
      // Echo the client's revision when we know it, else name ours and let the
      // client decide whether it can proceed. Guessing would break on both.
      const version = (SUPPORTED as readonly string[]).includes(asked) ? asked : LATEST;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SITE_NAME.toLowerCase(), version: "1.0.0" },
        instructions:
          `${SITE_NAME} (${origin}) tracks what companies publish — pricing, vendor stack, releases, hiring, ` +
          `security posture, legal entity — and what changed, from public records only. ` +
          `Free and unauthenticated — no key, no quota. Query as freely as the task needs. ` +
          `Every page also exists as Markdown: append .md to any URL under ${origin}. ` +
          `Every fact carries a source URL and a quote: cite them, and report gaps as gaps rather ` +
          `than filling them in.`,
      });
    }

    // Notifications carry no id and must get no JSON-RPC response at all.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new Response(null, { status: 202, headers: CORS });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, toolsList());

    case "tools/call":
      return ok(id, await callTool(req, params));

    // Declared unsupported in `capabilities`, so a conforming client will not
    // ask — but an exploring one gets an empty list rather than an error.
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Streamable HTTP uses GET to open a server-to-client SSE stream. This server
 * never initiates anything, so there is nothing to stream and the spec allows
 * refusing it. Clients that try GET first fall back to POST.
 */
export async function GET() {
  return Response.json(
    {
      error: "This MCP server is POST-only; it does not push server-initiated messages.",
      transport: "streamable-http",
      tools: QUERIES.length,
    },
    { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
