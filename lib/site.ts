/**
 * Canonical site identity, in one place.
 *
 * Every absolute URL in metadata, sitemaps, OG tags and JSON-LD derives from
 * here, so the eventual real domain is a single change rather than a hunt.
 */

/**
 * Base URL, in order of trust: an explicit setting, then Vercel's own
 * deployment host, then localhost for development. Never a hardcoded guess —
 * a wrong absolute URL in OG tags silently breaks every share preview.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
).replace(/\/$/, "");

/**
 * Product name, overridable by environment.
 *
 * NEXT_PUBLIC_ prefixed so it is readable from client components too — the
 * name belongs in the nav and the footer, and some of those will be client
 * components eventually. A rename is then one env var rather than a grep.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "DELTA";

export const SITE_TAGLINE =
  process.env.NEXT_PUBLIC_SITE_TAGLINE || "Competitor intelligence with its sources attached";

export const SITE_DESCRIPTION =
  process.env.NEXT_PUBLIC_SITE_DESCRIPTION ||
  "Track what competitors publish — pricing tiers, vendor stack, releases, hiring, security posture — " +
  "and what changed. Built from public records only, with every fact linked to the page it came from.";

export const abs = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
