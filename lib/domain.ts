/**
 * Public-domain validation. ZERO dependencies, on purpose.
 *
 * This is imported by `proxy.ts`, which runs before the request reaches a route
 * handler — so it must not transitively pull in `node:dns` or anything else
 * that is unavailable there. Keeping it in its own module is what lets the SSRF
 * boundary sit at the edge, ahead of streaming, which is also where the Next
 * docs say a 404 check belongs.
 */

/** Hosts and ranges that must never be fetched on a user's behalf. */
const BLOCKED_SUFFIX = [
  ".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp",
  ".test", ".example", ".invalid", ".onion", ".arpa",
];
const BLOCKED_EXACT = new Set([
  "localhost", "metadata", "metadata.google.internal", "instance-data",
]);

/**
 * Normalise and validate a domain from an untrusted URL segment.
 *
 * Returns null for anything that is not a plain, public, DNS-resolvable
 * hostname. Rejecting IP literals is the important part: a bare IP bypasses
 * every name-based check and is how SSRF reaches link-local metadata services.
 */
export function publicDomain(input: string): string | null {
  if (!input || input.length > 253) return null;

  let d: string;
  try {
    d = decodeURIComponent(input).trim().toLowerCase();
  } catch { return null; }

  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#\\]/)[0].split("@").pop() ?? "";
  d = d.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!d) return null;

  // No IP literals, in any notation. An IPv4, an IPv6, a bracketed IPv6, a
  // decimal/octal/hex integer form — all bypass hostname checks.
  if (/^\[?[0-9a-f:]+\]?$/i.test(d) && d.includes(":")) return null;
  if (/^\d+$/.test(d.replace(/\./g, ""))) return null;
  if (/^0x/i.test(d)) return null;

  // Structure: labels of a-z0-9-, not starting or ending with "-", plus a
  // final alphabetic TLD of at least two characters.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return null;

  if (BLOCKED_EXACT.has(d)) return null;
  if (BLOCKED_SUFFIX.some((s) => d.endsWith(s))) return null;
  // A single label is not a public domain.
  if (d.split(".").length < 2) return null;

  return d;
}

