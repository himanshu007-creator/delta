/**
 * The rate limiter, which is now the crawler's throttle rather than the LLM's.
 *
 * Salvaged from email.test.ts when the cold-email product was deleted: this was
 * the ONLY coverage of parseDuration and RateLimiter, and both survive the pivot
 * (DELTA polls ~50 sources on a 12h cadence and must honour every one's limits).
 *
 *   npx tsx lib/limiter.test.ts
 */

import assert from "node:assert/strict";
import { parseDuration, RateLimiter } from "./limiter";

// --- Retry-After / reset-header parsing ------------------------------------
// Providers answer in wildly different shapes and a misparse means we either
// hammer a source that asked us to wait, or sleep for hours on a typo.
{
  assert.equal(parseDuration("7.66s"), 7.66);
  assert.equal(parseDuration("2m59.56s"), 179.56);
  assert.equal(parseDuration("150ms"), 0.15);
  assert.equal(parseDuration("1h2m3s"), 3723);
  assert.equal(parseDuration("30"), 30, "a bare number is seconds, per retry-after");
  assert.equal(parseDuration(null), undefined);
  assert.equal(parseDuration("garbage"), undefined);
}

// --- Backoff behaviour ------------------------------------------------------
{
  const l = new RateLimiter({ tpm: 8000, rpm: 30, maxConcurrency: 8 });
  assert.equal(l.status.concurrency, 2, "must start cautious, not at max");

  // A 429 must halve concurrency and pause. GDELT and crt.sh both punish
  // ignoring this — see PHASE0.md, where sustained probing got us IP-blocked.
  l.penalise(3);
  assert.equal(l.status.concurrency, 1);
  assert.ok(l.status.pausedForMs > 2000, "must honour retry-after");

  // Clean responses earn throughput back, but slowly.
  const l2 = new RateLimiter({ maxConcurrency: 8 });
  for (let i = 0; i < 8; i++) l2.report({});
  assert.equal(l2.status.concurrency, 3, "additive increase, one slot per streak");
}

// --- THE DEADLOCK REGRESSION -----------------------------------------------
// A single request estimated larger than the entire token window used to make
// `used + est <= budget` unsatisfiable even with an empty window, so acquire()
// spun forever, Stop went inert and the whole run hung. Never again.
async function deadlockChecks() {
  const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
    Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`HUNG: ${what}`)), ms)),
    ]);

  // Groq's free ceiling is 7000 → budget 5950. A 9000-token prompt must still go.
  const l = new RateLimiter({ tpm: 7000, maxConcurrency: 4 });
  const release = await withTimeout(l.acquire(9000), 2000, "oversized request must not hang");
  assert.equal(typeof release, "function");
  release(9000);

  // Abort must break out of a backoff immediately, not wait it out. A 12h
  // crawl window cannot be held open by one source's 30s penalty.
  const l2 = new RateLimiter({ tpm: 7000, maxConcurrency: 1 });
  l2.penalise(30);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  await withTimeout(
    l2.acquire(100, ac.signal).then(
      () => { throw new Error("should have aborted"); },
      (e: Error) => { assert.equal(e.name, "AbortError"); },
    ),
    2000,
    "abort must interrupt a 30s backoff",
  );

  // An already-aborted signal must reject at once.
  const l3 = new RateLimiter({ maxConcurrency: 4 });
  await withTimeout(
    l3.acquire(10, AbortSignal.abort()).then(
      () => { throw new Error("should have aborted"); },
      (e: Error) => { assert.equal(e.name, "AbortError"); },
    ),
    1000,
    "pre-aborted signal",
  );

  // easeOff reduces parallelism without the full 429 penalty — the right
  // response to a 5xx or a socket error, which is most of what a crawler sees.
  const l4 = new RateLimiter({ maxConcurrency: 8 });
  for (let i = 0; i < 16; i++) l4.report({});
  const before = l4.status.concurrency;
  l4.easeOff();
  assert.equal(l4.status.concurrency, before - 1, "server errors must ease off, not halve");

  console.log("✓ limiter: parsing, backoff, abort and the deadlock regression all hold");
}

void deadlockChecks();
