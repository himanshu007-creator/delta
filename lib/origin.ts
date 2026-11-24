/**
 * The origin this request actually arrived on.
 *
 * Deliberately NOT the same thing as `SITE_URL`, and the distinction matters:
 *
 *   • SITE_URL is the CANONICAL origin, fixed at build. Everything a search
 *     engine consumes — canonical tags, OG images, the sitemap, JSON-LD —
 *     must use it. Deriving those from a request Host would mean anyone who
 *     pointed a domain at this deployment would serve your pages with
 *     self-referencing canonicals, which is an SEO own-goal at best.
 *
 *   • requestOrigin() is where the caller IS. Copy-paste snippets, the MCP
 *     server's self-reported endpoint and the "append .md to this URL" hint
 *     should all match the address in the user's bar — their custom domain,
 *     their fork, their preview deployment, or localhost.
 *
 * So a self-hosted copy needs no configuration for any of the second group,
 * which is the point: clone, deploy, and the docs already tell you your own
 * URL rather than this one.
 */

import { headers } from "next/headers";
import { SITE_URL } from "./site";

/** A host must look like a host. The Host header is attacker-controlled. */
const SAFE_HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Origin from the request, falling back to the canonical one.
 *
 * `x-forwarded-*` are set by the platform's proxy. They are trusted only to
 * the extent that the value is then validated and used for DISPLAY — never
 * for a redirect, a fetch, or anything a forged header could weaponise.
 */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host || !SAFE_HOST.test(host)) return SITE_URL;

    const proto =
      h.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    if (proto !== "http" && proto !== "https") return SITE_URL;

    return `${proto}://${host}`;
  } catch {
    // headers() throws outside a request scope, e.g. during prerender.
    return SITE_URL;
  }
}
