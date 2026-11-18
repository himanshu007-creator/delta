/**
 * The free-tier email gate.
 *
 * Salvaged from email.test.ts during the pivot: `checkEmail` is unchanged and
 * still guards the free tier, so its coverage must not die with the cold-email
 * product.
 *
 *   npx tsx lib/usage-store.test.ts
 */

import assert from "node:assert/strict";
import { checkEmail } from "./usage-store";

// The gate is only as good as its normalisation. Gmail ignores dots and
// everything after a plus, so without collapsing them one person has infinite
// free tiers just by typing a different address.
{
  const ok = (e: string) => {
    const r = checkEmail(e);
    assert.ok(r.ok, `${e} should be accepted`);
    return r.ok ? r.email : "";
  };
  const blocked = (e: string, reason: string) => {
    const r = checkEmail(e);
    assert.ok(!r.ok, `${e} should be blocked`);
    assert.equal(r.ok ? "" : r.reason, reason, `${e} wrong reason`);
  };

  // THE ALIAS ATTACK: every one of these is the same Gmail mailbox.
  const canonical = ok("hi@gmail.com");
  for (const alias of [
    "h.i@gmail.com",
    "H.I@Gmail.com",
    "hi+anything@gmail.com",
    "h.i+1@GMAIL.COM",
    "  hi@gmail.com  ",
  ]) {
    assert.equal(ok(alias), canonical, `${alias} must collapse to one mailbox`);
  }

  // Outlook keeps dots as significant, so these are genuinely different —
  // over-normalising would merge two real people into one meter.
  assert.notEqual(ok("a.b@outlook.com"), ok("ab@outlook.com"));
  // ...but it does ignore +tags.
  assert.equal(ok("a.b+tag@outlook.com"), ok("a.b@outlook.com"));

  blocked("a@mailinator.com", "disposable");
  blocked("x@10minutemail.com", "disposable");
  blocked("not-an-email", "shape");
  blocked("@nodomain.com", "shape");
  blocked("", "shape");
  blocked(42 as unknown as string, "shape");

  // Real work addresses must sail through untouched.
  assert.equal(ok("sam@acme.co"), "sam@acme.co");
  assert.equal(ok("first.last@agency.io"), "first.last@agency.io");

  // Consumer providers are allowed by default ON PURPOSE: most marketers and
  // PMs buying this run on Gmail, and blocking them to deter a second signup
  // trades real buyers for a rounding error of abuse.
  assert.ok(checkEmail("someone@gmail.com").ok, "freemail must be allowed by default");

  console.log("✓ usage-store: the free-tier email gate holds");
}
