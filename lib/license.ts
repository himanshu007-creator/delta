/**
 * Licences: the one thing $99 actually buys.
 *
 * The problem this solves: generation runs in the user's browser with the
 * user's own API key, so there is nothing there to gate — any check in
 * client-side code is editable by the person it is meant to stop.
 *
 * The chokepoint is /api/research. A browser cannot fetch a prospect's
 * website directly: cross-origin requests need the target site to send
 * Access-Control-Allow-Origin, and company marketing sites do not. So the
 * research proxy is genuinely required, it is server-side, and it is the
 * expensive half of a run. Gate it and the product is monetisable without
 * the user's key ever touching our servers.
 */

import { usageStore } from "./usage-store";

/** Creem's key format: ABCDE-FGHIJ-KLMNO-PQRST-UVWXY. */
const KEY_SHAPE = /^[A-Z0-9]{4,8}(-[A-Z0-9]{4,8}){2,5}$/;

export type LicenseCheck =
  | { ok: true; rowsUsed: number }
  | { ok: false; reason: "shape" | "unknown" | "unconfigured" };

export function normaliseKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().toUpperCase();
  return KEY_SHAPE.test(k) ? k : null;
}

/**
 * Validate `key` and charge it for `rows`.
 *
 * Checked against our own table, not Creem's /licenses/validate: that endpoint
 * requires an instance_id from a prior activate call, which would add an
 * activation dance plus a network round-trip to every run. See schema.sql.
 */
export async function useLicense(raw: unknown, rows: number): Promise<LicenseCheck> {
  const key = normaliseKey(raw);
  if (!key) return { ok: false, reason: "shape" };

  const store = usageStore();
  // Without Supabase there is no licence table to check against.
  //
  // In production, fail CLOSED: a licence that cannot be verified must not
  // unlock anything, or the paid route is open to any correctly-shaped string.
  // In development, fall through to the in-memory store so the paid flow is
  // testable without a real purchase. The check is on NODE_ENV, which Next
  // sets to "production" in any build, so this cannot leak to a deployment.
  if (!store.isDurable && process.env.NODE_ENV === "production") {
    return { ok: false, reason: "unconfigured" };
  }

  const rowsUsed = await store.useLicense(key, Math.max(0, rows));
  return rowsUsed === null ? { ok: false, reason: "unknown" } : { ok: true, rowsUsed };
}
