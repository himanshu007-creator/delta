/**
 * Creem webhook: the only way a licence is ever created.
 *
 * Creem is the merchant of record, which matters for two reasons beyond
 * convenience: it handles global tax, and it is listed on TrustMRR's own
 * homepage as a supported provider. The hackathon verifies every dollar
 * through TrustMRR, so revenue taken through an unsupported processor is
 * revenue that cannot be counted.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { usageStore } from "@/lib/usage-store";
import { normaliseKey } from "@/lib/license";

/** HMAC-SHA256 of the raw body, hex, per docs.creem.io/code/webhooks. */
function signatureMatches(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Compare in constant time. A plain === leaks the correct prefix length
  // through timing, letting a signature be guessed byte by byte. The docs
  // do not mention this; it is required regardless.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type CreemLicense = { key?: unknown };
type CreemEvent = {
  eventType?: string;
  object?: {
    license_keys?: CreemLicense[];
    customer?: { email?: unknown };
    order?: { id?: unknown; amount?: unknown };
    product?: { id?: unknown };
  };
};

export async function POST(req: Request) {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    // Never accept an unverified purchase event. Without the secret we
    // cannot tell Creem from anyone who found the URL.
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  // Raw text, not req.json(): the signature covers the exact bytes sent, and
  // re-serialising a parsed object will not reproduce them.
  const raw = await req.text();
  if (!signatureMatches(raw, req.headers.get("creem-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let event: CreemEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Only completed one-time checkouts mint licences. Everything else is
  // acknowledged so Creem stops retrying it.
  if (event.eventType !== "checkout.completed") {
    return NextResponse.json({ ok: true, ignored: event.eventType ?? null });
  }

  const o = event.object ?? {};
  const email = typeof o.customer?.email === "string" ? o.customer.email : "";
  const keys = (Array.isArray(o.license_keys) ? o.license_keys : [])
    .map((l) => normaliseKey(l?.key))
    .filter((k): k is string => k !== null);

  if (!email || keys.length === 0) {
    // 200, deliberately: retrying will not conjure a licence key, and the
    // docs give 5 retries over 24h to anything non-2xx. Surfaces in logs.
    console.error("creem checkout.completed without email or license_keys", {
      hasEmail: Boolean(email),
      keyCount: keys.length,
    });
    return NextResponse.json({ ok: true, recorded: 0 });
  }

  const store = usageStore();
  const orderId = typeof o.order?.id === "string" ? o.order.id : undefined;
  const productId = typeof o.product?.id === "string" ? o.product.id : undefined;
  const amount = typeof o.order?.amount === "number" ? o.order.amount : undefined;

  // record_license is `on conflict do nothing`, so Creem's retries are safe.
  await Promise.all(
    keys.map((key) => store.recordLicense({ key, email, orderId, productId, amount })),
  );

  return NextResponse.json({ ok: true, recorded: keys.length });
}
