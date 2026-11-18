/**
 * Free-tier metering, on Supabase.
 *
 * The free tier runs on OUR Groq key, which is why generation for it happens
 * server-side: ship that key to the browser and it is readable in devtools on
 * the first request, and someone else spends your money.
 *
 * Postgres rather than a KV store, because the same table is three things at
 * once: the usage meter, the launch mailing list (the whole point of asking
 * for an email), and later the place Creem purchases land. Volume is tiny —
 * Groq's free tier caps us near 110 emails a day — so Redis's throughput edge
 * buys nothing here.
 *
 * Two budgets, failing in opposite directions on purpose:
 *  - PER USER: how many emails one address may ever generate.
 *  - GLOBAL PER DAY: a ceiling so a scripted abuser cannot drain the account
 *    overnight. When it is hit, everyone is offered bring-your-own-key, which
 *    is instant and costs us nothing.
 *
 * Without Supabase env vars it falls back to memory: correct in dev, WRONG in
 * production, because serverless instances do not share memory and the limit
 * would reset per instance. `isDurable` exists so the app can say so out loud
 * rather than quietly leaking free usage.
 */

import validator from "validator";
import disposableDomains from "disposable-email-domains";

export const FREE_ROWS_PER_USER = Number(process.env.FREE_ROWS_PER_USER ?? 25);

/**
 * Deliberately below Groq's ~200k tokens/day free ceiling (we send fewer
 * signals on the free path, ~1.6k tokens an email) so we degrade with a clear
 * message instead of a provider 429.
 */
export const FREE_ROWS_PER_DAY = Number(process.env.FREE_ROWS_PER_DAY ?? 110);

export type UsageStore = {
  isDurable: boolean;
  getUser(email: string): Promise<number>;
  addUser(email: string, n: number): Promise<number>;
  getToday(): Promise<number>;
  addToday(n: number): Promise<number>;
  /** Charge a licence for n rows. Returns rows_used after, or null if unknown/revoked. */
  useLicense(key: string, n: number): Promise<number | null>;
  /** Record a purchase. Idempotent. */
  recordLicense(l: {
    key: string; email: string; orderId?: string; productId?: string; amount?: number;
  }): Promise<void>;
};

const today = () => new Date().toISOString().slice(0, 10);

// --- Memory (dev only) ------------------------------------------------------

function memoryStore(): UsageStore {
  const m = new Map<string, number>();
  const bump = (k: string, n: number) => {
    const next = (m.get(k) ?? 0) + n;
    m.set(k, next);
    return next;
  };
  return {
    isDurable: false,
    async getUser(email) {
      return m.get(`u:${email}`) ?? 0;
    },
    async addUser(email, n) {
      return bump(`u:${email}`, n);
    },
    async getToday() {
      return m.get(`d:${today()}`) ?? 0;
    },
    async addToday(n) {
      return bump(`d:${today()}`, n);
    },
    // Dev only. Any shaped key works so the paid path is testable without
    // a real purchase; useLicense() refuses to use this store in production.
    async useLicense(key, n) {
      return bump(`l:${key}`, n);
    },
    async recordLicense() {},
  };
}

// --- Supabase ---------------------------------------------------------------
// Called over PostgREST rather than through the SDK so this file stays
// dependency-free and works before the integration is installed.
//
// Increments go through SQL functions (see supabase/schema.sql) because
// read-then-write from a serverless function races: two concurrent runs would
// both read 10 and both write 11, and the free tier would leak.

function supabaseStore(url: string, key: string): UsageStore {
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<number> => {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`usage store ${res.status}: ${await res.text()}`);
    const n = Number(await res.json());
    return Number.isFinite(n) ? n : 0;
  };

  const rpcNullable = async (fn: string, args: Record<string, unknown>): Promise<number | null> => {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`usage store ${res.status}: ${await res.text()}`);
    const v = await res.json();
    // An unknown or revoked key returns SQL null. Never coerce that to 0:
    // Number(null) is 0, which would read as a valid licence at zero rows.
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    isDurable: true,
    getUser: (email) => rpc("free_rows_for_user", { p_email: email }),
    addUser: (email, n) => rpc("bump_free_rows_for_user", { p_email: email, p_n: n }),
    getToday: () => rpc("free_rows_today", { p_day: today() }),
    addToday: (n) => rpc("bump_free_rows_today", { p_day: today(), p_n: n }),
    useLicense: (key, n) => rpcNullable("use_license", { p_key: key, p_n: n }),
    recordLicense: (l) =>
      rpc("record_license", {
        p_key: l.key,
        p_email: l.email,
        p_order_id: l.orderId ?? null,
        p_product_id: l.productId ?? null,
        p_amount: l.amount ?? null,
      }).then(() => undefined),
  };
}

let cached: UsageStore | null = null;

export function usageStore(): UsageStore {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  // SERVICE ROLE, server-only. Never expose this to the client: it bypasses
  // row-level security and can read every address in the table.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? supabaseStore(url.replace(/\/$/, ""), key) : memoryStore();
  return cached;
}

export type FreeCheck =
  | { ok: true; remaining: number }
  | { ok: false; reason: "user-exhausted" | "day-exhausted"; remaining: 0 };

/** Decide whether `email` may generate `want` more emails right now. */
export async function checkFreeBudget(email: string, want: number): Promise<FreeCheck> {
  const store = usageStore();
  const [used, used_today] = await Promise.all([store.getUser(email), store.getToday()]);

  const userLeft = Math.max(0, FREE_ROWS_PER_USER - used);
  if (userLeft <= 0) return { ok: false, reason: "user-exhausted", remaining: 0 };

  const dayLeft = Math.max(0, FREE_ROWS_PER_DAY - used_today);
  if (dayLeft <= 0) return { ok: false, reason: "day-exhausted", remaining: 0 };

  return { ok: true, remaining: Math.min(want, userLeft, dayLeft) };
}

/** Record only what was actually generated, never what was requested. */
export async function recordFreeUsage(email: string, n: number): Promise<void> {
  if (n <= 0) return;
  const store = usageStore();
  await Promise.all([store.addUser(email, n), store.addToday(n)]);
}

// --- Email validation -------------------------------------------------------

const DISPOSABLE = new Set(disposableDomains as string[]);

/**
 * Consumer mailbox providers.
 *
 * Blocking these is OFF by default and that is a deliberate product call, not
 * an oversight. LEDE sells to solo founders, freelancers and small agencies,
 * and a large share of them legitimately run on Gmail. Rejecting them at the
 * door to stop someone creating a second Gmail account trades real buyers for
 * a rounding error of abuse — especially when the alias normalisation below
 * already kills the cheap version of that attack.
 *
 * Set BLOCK_FREEMAIL=1 if that trade ever looks worth it.
 */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com",
  "yandex.com", "zoho.com", "tutanota.com", "fastmail.com",
]);

export type EmailCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "shape" | "disposable" | "freemail"; message: string };

/**
 * Normalise and vet an address for the free tier.
 *
 * Normalisation matters more than validation here. Gmail ignores dots and
 * everything after a plus, so `h.i+1@gmail.com` and `hi@gmail.com` are one
 * mailbox — and without collapsing them, one person has infinite free tiers.
 * validator.normalizeEmail knows the per-provider rules (Gmail strips dots,
 * Outlook does not), which is why this is not a hand-rolled regex.
 */
export function checkEmail(raw: unknown): EmailCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: "shape", message: "That email doesn't look right." };
  }
  const trimmed = raw.trim();
  if (!validator.isEmail(trimmed, { allow_utf8_local_part: false })) {
    return { ok: false, reason: "shape", message: "That email doesn't look right." };
  }

  const normalised = validator.normalizeEmail(trimmed, {
    all_lowercase: true,
    gmail_remove_dots: true,
    gmail_remove_subaddress: true,
    outlookdotcom_remove_subaddress: true,
    yahoo_remove_subaddress: true,
    icloud_remove_subaddress: true,
  });
  if (!normalised) {
    return { ok: false, reason: "shape", message: "That email doesn't look right." };
  }

  const domain = normalised.split("@")[1] ?? "";

  if (DISPOSABLE.has(domain)) {
    return {
      ok: false,
      reason: "disposable",
      message: "Temporary email addresses aren't accepted. Use one you actually read.",
    };
  }

  if (process.env.BLOCK_FREEMAIL === "1" && FREEMAIL.has(domain)) {
    return {
      ok: false,
      reason: "freemail",
      message: "Please use your work email address.",
    };
  }

  return { ok: true, email: normalised };
}

/** Back-compat helper: the normalised address, or null. */
export function normaliseEmail(raw: unknown): string | null {
  const r = checkEmail(raw);
  return r.ok ? r.email : null;
}
