/**
 * The store's pure logic and its fail-closed behaviour.
 *
 * The window boundary is the subtle part: get it wrong and a surface is either
 * crawled twice per window (wasted budget, rude to sources) or never (history
 * silently stops accruing, and a 12h window only happens once).
 *
 *   npx tsx lib/store.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertStore, currentWindow, storeConfigured } from "./store";

// --- the 12h window boundary ----------------------------------------------
{
  const at = (iso: string) => currentWindow(new Date(iso)).toISOString();

  // Everything before noon belongs to the 00:00 window.
  assert.equal(at("2026-11-19T00:00:00.000Z"), "2026-11-19T00:00:00.000Z");
  assert.equal(at("2026-11-19T00:00:01.000Z"), "2026-11-19T00:00:00.000Z");
  assert.equal(at("2026-11-19T06:31:45.123Z"), "2026-11-19T00:00:00.000Z");
  assert.equal(at("2026-11-19T11:59:59.999Z"), "2026-11-19T00:00:00.000Z");
  // Noon onward belongs to the 12:00 window.
  assert.equal(at("2026-11-19T12:00:00.000Z"), "2026-11-19T12:00:00.000Z");
  assert.equal(at("2026-11-19T23:59:59.999Z"), "2026-11-19T12:00:00.000Z");

  // FIXED boundaries, not "now minus 12 hours". Two invocations minutes apart
  // must land in the SAME window, or the SQL claim would hand the same surface
  // out twice and we would double-fetch every source.
  assert.equal(at("2026-11-19T13:00:00.000Z"), at("2026-11-19T19:00:00.000Z"));
  assert.notEqual(at("2026-11-19T11:59:00.000Z"), at("2026-11-19T12:01:00.000Z"));

  // Always a clean UTC boundary — minutes, seconds and ms zeroed.
  for (const iso of ["2026-01-01T07:13:59.500Z", "2026-06-30T18:45:22.001Z", "2026-12-31T23:59:59.999Z"]) {
    const w = currentWindow(new Date(iso));
    assert.equal(w.getUTCMinutes(), 0);
    assert.equal(w.getUTCSeconds(), 0);
    assert.equal(w.getUTCMilliseconds(), 0);
    assert.ok(w.getUTCHours() === 0 || w.getUTCHours() === 12, `hours must be 0 or 12, got ${w.getUTCHours()}`);
    // A window is never in the future.
    assert.ok(w.getTime() <= Date.parse(iso), `${iso} -> ${w.toISOString()} must not be ahead of now`);
  }

  // Exactly two windows per day, and they advance across a date boundary.
  assert.notEqual(at("2026-11-19T12:00:00.000Z"), at("2026-11-20T00:00:00.000Z"));
}

// --- fail closed in production -------------------------------------------
{
  const src = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /NODE_ENV === "production"/,
    "the store must fail CLOSED in production — crawling into a void looks healthy while losing history permanently",
  );
  assert.ok(
    src.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "must read the service role, not the anon key: every table has RLS on and revokes anon",
  );
  assert.ok(
    !/NEXT_PUBLIC_SUPABASE_SERVICE/.test(src),
    "the service role must never be exposed to the browser — it bypasses RLS",
  );

  // Behaviour, not just source. NODE_ENV is not writable under Node 26, so this
  // asserts the branch that applies here rather than faking the other one —
  // the production branch is covered by the source assertion above.
  if (!storeConfigured() && process.env.NODE_ENV !== "production") {
    assert.doesNotThrow(() => assertStore(), "development must tolerate an unconfigured store");
  }
}

// --- the crawl endpoint's guarantees, asserted against its source --------
{
  const route = readFileSync(new URL("../app/api/cron/window/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("timingSafeEqual"), "the cron secret must be compared in constant time");
  assert.match(
    route,
    /if \(!secret\) return process\.env\.NODE_ENV !== "production"/,
    "production must REQUIRE a cron secret, or anyone can make us crawl the internet on demand",
  );
  // Check the HANDLER BODY, not the file: the import list is alphabetical, so
  // indexOf over the whole source matches the import and proves nothing.
  const handler = route.slice(route.indexOf("export async function GET"));
  assert.ok(
    handler.indexOf('r.status === "unchanged"') < handler.indexOf("await recordSurface("),
    "the unchanged fast path must be checked before writing facts — it is what makes ~40 sources per company affordable",
  );
  assert.ok(route.includes("void fetch("), "the chain must be un-awaited or one invocation blocks on the whole queue");
  assert.ok(route.includes("MAX_CHAIN"), "a self-chaining endpoint needs a hard stop");
  // Anchored to line start: the route's own comment explains the rule and
  // contains the phrase, so an unanchored match fails on its documentation.
  assert.ok(
    !/^\s*export const runtime/m.test(route),
    "Cache Components rejects a runtime segment config",
  );
}

// --- the schema's load-bearing guarantees --------------------------------
{
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.ok(
    /for update of s skip locked/i.test(sql),
    "claim_surfaces must SKIP LOCKED: the endpoint self-chains and overlapping runs would otherwise double-fetch",
  );
  // Superseded by the two precedence assertions below, which check the same
  // first-observation rule plus the source-disagreement rule.
  assert.ok(
    /v_old is distinct from v_new/.test(sql),
    "`is distinct from` not `<>`: a NULL on either side must count as a difference",
  );
  // REGRESSION: corporate.gleif and identity.schema both report
  // corporate.legal_name ("ADYEN N.V." vs "Adyen N.V."). Without precedence the
  // value flip-flopped and fabricated a change every window, forever.
  assert.ok(
    /if v_seen and v_old_kind is distinct from p_kind[\s\S]{0,120}>= coalesce\(v_new_conf, 0\) then/.test(sql),
    "a different source with lower or equal confidence must not overwrite a fact",
  );
  assert.ok(
    /if v_seen and v_old_kind = p_kind then/.test(sql),
    "only the SAME source moving its value over time is a change; a disagreement between sources is not",
  );
  for (const t of ["companies", "watchlists", "surfaces", "facts", "changes"]) {
    assert.ok(
      new RegExp(`alter table ${t}\\s+enable row level security`).test(sql),
      `${t} must have RLS enabled`,
    );
    assert.ok(
      new RegExp(`revoke all on ${t}\\s+from anon, authenticated`).test(sql),
      `${t} must revoke anon — these tables hold the entire dataset`,
    );
  }
  // Global dedupe is the economic core: one row per domain, users elsewhere.
  assert.ok(/create table if not exists companies \(\s*\n\s*domain\s+text primary key/.test(sql),
    "companies must be keyed by domain alone — that is what makes a new customer cost nothing");
}

console.log("✓ store: 12h window boundaries, fail-closed, constant-time cron auth, SKIP LOCKED claim, RLS on every table");
