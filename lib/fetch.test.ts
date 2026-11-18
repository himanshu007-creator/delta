/**
 * The fetcher, against a real local server so the behaviour is observed rather
 * than mocked. Every case here is a failure mode Phase 0 actually hit.
 *
 *   npx tsx lib/fetch.test.ts
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fetchJson, fetchRaw, fetchText } from "./fetch";

/** Request counts per path — how we prove retry behaviour rather than assume it. */
const hits: Record<string, number> = {};

const server: Server = createServer((req, res) => {
  const path = req.url ?? "/";
  hits[path] = (hits[path] ?? 0) + 1;
  const n = hits[path];

  switch (true) {
    case path === "/ok":
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ hello: "world" }));

    // Rate-limited twice, then succeeds. Retry-After is 1s.
    case path === "/flaky":
      if (n <= 2) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
        return res.end(JSON.stringify({ error: "slow down" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ recovered: true, attempts: n }));

    // THE GDELT CASE: 429 whose body is prose, not JSON.
    case path === "/prose-429":
      res.writeHead(429, { "content-type": "text/plain" });
      return res.end("Please limit requests to one every 5 seconds or contact someone@example.com");

    // A 200 that is prose on an endpoint we asked JSON of.
    case path === "/prose-200":
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("not json at all");

    case path === "/404":
      res.writeHead(404);
      return res.end("nope");

    case path === "/big":
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ pad: "x".repeat(50_000) }));

    case path === "/slow":
      return setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); }, 3000);

    case path === "/html":
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end("<html><body><h1>Pricing</h1>$29/mo</body></html>");

    default:
      res.writeHead(500);
      return res.end("boom");
  }
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  // --- happy path + content hash --------------------------------------------
  {
    const a = await fetchJson<{ hello: string }>(`${base}/ok`);
    assert.ok(a.ok, "plain JSON must succeed");
    assert.equal(a.body.hello, "world");
    assert.match(a.hash, /^[0-9a-f]{64}$/, "must expose a sha256 of the raw body");

    // The hash is the differ's fast path, so identical bytes MUST hash equal.
    const b = await fetchJson<{ hello: string }>(`${base}/ok`);
    assert.ok(b.ok);
    assert.equal(a.hash, b.hash, "unchanged content must produce an identical hash");
  }

  // --- retries, and Retry-After being obeyed --------------------------------
  {
    const t0 = Date.now();
    const r = await fetchJson<{ recovered: boolean; attempts: number }>(`${base}/flaky`, { attempts: 4 });
    const ms = Date.now() - t0;
    assert.ok(r.ok, `must recover after 429s, got ${!r.ok ? r.detail : ""}`);
    assert.equal(r.body.attempts, 3, "should have taken exactly 3 attempts");
    // Two 429s each asking for 1s. Anything much under 2s means we ignored the header.
    assert.ok(ms >= 1900, `must honour Retry-After (waited only ${ms}ms)`);
    assert.ok(ms < 10_000, `must not over-wait (waited ${ms}ms)`);
  }

  // --- the GDELT case: a 429 carrying prose ---------------------------------
  {
    const r = await fetchJson(`${base}/prose-429`, { attempts: 1 });
    assert.ok(!r.ok);
    assert.equal(r.reason, "rate-limited", "429 must be classified as rate-limited, not not-json");
    assert.match(r.detail, /limit requests/, "the prose diagnostic must survive, not be swallowed");
  }

  // --- prose on a 200 must not throw ----------------------------------------
  {
    const r = await fetchJson(`${base}/prose-200`, { attempts: 1 });
    assert.ok(!r.ok);
    assert.equal(r.reason, "not-json");
    assert.match(r.detail, /not json/);
  }

  // --- a 404 must NOT be retried --------------------------------------------
  {
    hits["/404"] = 0;
    const r = await fetchRaw(`${base}/404`, { attempts: 3 });
    assert.ok(!r.ok);
    assert.equal(r.reason, "http");
    assert.equal(r.status, 404);
    assert.equal(hits["/404"], 1, "a 404 is an answer — retrying it wastes a window");
  }

  // --- byte cap -------------------------------------------------------------
  {
    const r = await fetchJson(`${base}/big`, { maxBytes: 1000, attempts: 1 });
    assert.ok(!r.ok);
    assert.equal(r.reason, "too-large");
  }

  // --- timeout --------------------------------------------------------------
  {
    const r = await fetchJson(`${base}/slow`, { timeoutMs: 300, attempts: 1 });
    assert.ok(!r.ok);
    assert.equal(r.reason, "timeout");
  }

  // --- caller abort must stop the retry loop immediately --------------------
  {
    hits["/flaky"] = 0;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const t0 = Date.now();
    const r = await fetchJson(`${base}/flaky`, { attempts: 5, signal: ac.signal });
    assert.ok(!r.ok, "an aborted fetch must not report success");
    assert.ok(Date.now() - t0 < 1500, "abort must break the backoff, not wait it out");
  }

  // --- html path ------------------------------------------------------------
  {
    const r = await fetchText(`${base}/html`);
    assert.ok(r.ok);
    assert.match(r.body, /\$29\/mo/, "server-rendered prices must come through intact");
  }

  // --- never throws ---------------------------------------------------------
  {
    const r = await fetchJson("http://127.0.0.1:1/nothing-listening", { attempts: 1 });
    assert.ok(!r.ok);
    assert.equal(r.reason, "network", "a dead host is a value, never an exception");
  }

  server.close();
  console.log("✓ fetch: hashing, retries, Retry-After, prose errors, caps, timeout and abort all hold");
}

main().catch((e) => { server.close(); throw e; });
