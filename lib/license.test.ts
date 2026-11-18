/**
 * The money path. A silent bug here either gives the product away or
 * refuses paying customers, and neither shows up in a screenshot.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseKey } from "./license";

// --- Key shape --------------------------------------------------------------

const CREEM_SHAPE = "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY";
assert.equal(normaliseKey(CREEM_SHAPE), CREEM_SHAPE, "Creem's documented format must pass");
assert.equal(
  normaliseKey("  abcde-fghij-klmno-pqrst-uvwxy  "),
  CREEM_SHAPE,
  "a pasted key with stray whitespace and lowercase must still match the stored key",
);
for (const bad of ["", "   ", "not-a-key!", "ABCDE", "ABCDE-FGHIJ", null, undefined, 42, {}]) {
  assert.equal(normaliseKey(bad as unknown), null, `must reject ${JSON.stringify(bad)}`);
}

// --- Webhook signature ------------------------------------------------------
// Mirrors app/api/webhook/creem/route.ts: HMAC-SHA256 over the raw body, hex.

const SECRET = "whsec_test_not_a_real_secret";
const BODY = JSON.stringify({ eventType: "checkout.completed", object: { id: "ch_1" } });
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

assert.equal(sign(BODY).length, 64, "hex sha256 is 64 chars");
assert.notEqual(sign(BODY), sign(BODY + " "), "a single added byte must change the signature");
assert.notEqual(sign(BODY), sign(BODY, "wrong-secret"), "the wrong secret must not verify");

// The route lower-cases and trims the header before comparing, so a signature
// that differs only in case must still verify.
assert.equal(
  sign(BODY).toUpperCase().toLowerCase(),
  sign(BODY),
  "case normalisation must not alter a valid signature",
);

// --- The bug that would have given the product away -------------------------
// use_license returns SQL null for an unknown or revoked key. Number(null) is
// 0, so coercing before the null check reads as "valid licence, zero rows
// used" and unlocks the paid route for any correctly-shaped string.
assert.equal(Number(null), 0, "this is the trap the null check exists for");

const store = readFileSync(new URL("./usage-store.ts", import.meta.url), "utf8");
const nullable = store.slice(store.indexOf("rpcNullable"));
const nullCheck = nullable.indexOf("if (v === null) return null");
const coercion = nullable.indexOf("Number(v)");
assert.ok(nullCheck !== -1, "rpcNullable must explicitly check for null");
assert.ok(
  nullCheck !== -1 && coercion !== -1 && nullCheck < coercion,
  "the null check must come BEFORE Number(), or an unknown key unlocks the paid route",
);

// --- Fail closed ------------------------------------------------------------
const license = readFileSync(new URL("./license.ts", import.meta.url), "utf8");
assert.ok(
  /!store\.isDurable && process\.env\.NODE_ENV === "production"/.test(license),
  "without Supabase, production must fail CLOSED or any shaped string unlocks the paid route",
);
assert.ok(
  license.includes('reason: "unconfigured"'),
  "the closed path must say why, so a misconfigured deploy is diagnosable",
);

// --- The paid route is actually gated ---------------------------------------
// Retargeted from the deleted /api/research to the metered query API, which is
// now the only enforceable chokepoint. The assertions are unchanged in substance.
const route = readFileSync(new URL("../app/api/v1/[query]/route.ts", import.meta.url), "utf8");
assert.ok(route.includes("useLicense("), "/api/v1 must check a licence");
assert.ok(
  route.indexOf("useLicense(") < route.indexOf("await runQuery("),
  "the licence must be charged BEFORE the work, or concurrent runs all slip through",
);
assert.ok(route.includes("status: 402"), "an unlicensed request must return 402, not 200");

// --- No give-it-away copy ---------------------------------------------------
// The landing page once promised unlimited BYOK for free, which made the $99
// buy nothing. Assert the promise cannot come back.
for (const f of ["../app/page.tsx"]) {
  const text = readFileSync(new URL(f, import.meta.url), "utf8");
  assert.ok(
    !/own (API )?key and keep going (for )?free/i.test(text),
    `${f} must not promise unlimited free BYOK — that is the product`,
  );
}

// --- The webhook cannot be spoofed ------------------------------------------
const hook = readFileSync(new URL("../app/api/webhook/creem/route.ts", import.meta.url), "utf8");
assert.ok(hook.includes("timingSafeEqual"), "signature comparison must be constant time");
assert.ok(hook.includes("await req.text()"), "must verify the RAW body, not a re-serialised object");
assert.ok(
  hook.indexOf("signatureMatches(") < hook.indexOf("JSON.parse(raw)"),
  "verify the signature BEFORE parsing or trusting any field",
);
assert.ok(
  !hook.includes("CREEM_WEBHOOK_SECRET!"),
  "a missing secret must be handled, not asserted away — it would accept unsigned purchases",
);

// --- The two free-row constants must not drift ----------------------------
// lib/offer.ts duplicates the number for client components, because
// usage-store pulls in the 121k-domain disposable list and must stay off the
// browser bundle. A mismatch would show one figure and enforce another.
const offer = readFileSync(new URL("./offer.ts", import.meta.url), "utf8");
const store2 = readFileSync(new URL("./usage-store.ts", import.meta.url), "utf8");
const offerRows = offer.match(/FREE_ROWS = (\d+)/)?.[1];
const storeRows = store2.match(/FREE_ROWS_PER_USER = Number\(process\.env\.FREE_ROWS_PER_USER \?\? (\d+)\)/)?.[1];
assert.ok(offerRows && storeRows, "both free-row constants must be findable");
assert.equal(
  offerRows,
  storeRows,
  "offer.FREE_ROWS must match usage-store's default, or the UI promises a different number than the server enforces",
);

// usage-store must never be imported by a client component: it would ship
// 121,570 disposable domains to every visitor.
//
// This used to check one known file. Now it scans EVERY client component, so
// the rule holds for components that do not exist yet — which is the whole
// point, since the file it originally guarded has since been deleted.
{
  const roots = ["../app", "../lib"].map((r) => fileURLToPath(new URL(r, import.meta.url)));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  const offenders = roots
    .flatMap(walk)
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return /^\s*["']use client["']/m.test(src) && /from "@\/lib\/usage-store"|from "\.\/usage-store"/.test(src);
    });

  assert.deepEqual(
    offenders,
    [],
    `client components must not import usage-store — it would bundle the 121k-domain disposable list: ${offenders.join(", ")}`,
  );
}

console.log("✓ licence gating, webhook signatures and the paid chokepoint all hold");
