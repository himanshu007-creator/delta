/**
 * Edge validation for the public company pages.
 *
 * Why this exists rather than validating in the page: Cache Components sends
 * the prerendered shell first, which "starts the response with a 200, even when
 * the shell has no visible UI". So a `notFound()` raised inside a Suspense
 * boundary renders the 404 UI but cannot change the status line — a soft 404.
 *
 * The Next docs prescribe exactly this fix: "For a 404, you can check the slug
 * in Proxy... Keep Proxy checks fast, and avoid fetching full content there."
 *
 * It also moves the SSRF boundary EARLIER, which is strictly better: a request
 * for /c/169.254.169.254 is refused before any route code runs. The check is
 * pure string work with no I/O, so it adds nothing measurable to a request.
 */

import { NextResponse, type NextRequest } from "next/server";
import { publicDomain } from "./lib/domain";
import VENDOR_SLUGS from "./lib/stack-vendors.generated.json" with { type: "json" };
import { pairKey, parsePair } from "./lib/seed";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const match = /^\/c\/([^/]+)\/?$/.exec(pathname);
  if (match) {
    const raw = match[1];
    const domain = publicDomain(raw);

    // Refused: an IP literal, a private or reserved host, or a malformed name.
    // A real 404 rather than a 200 with 404-shaped UI.
    if (!domain) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
      });
    }

    // One canonical URL per company, so the SEO pages do not split their own
    // ranking across www/upper-case/trailing-slash variants.
    if (domain !== raw) {
      const url = request.nextUrl.clone();
      url.pathname = `/c/${domain}`;
      return NextResponse.redirect(url, 308);
    }
  }

  // /stack/[vendor] is fully prerendered from a committed index, so an unknown
  // vendor can be rejected here rather than rendering a 200 with 404 UI.
  // `dynamicParams = false` would be the idiomatic way, but Cache Components
  // rejects that segment config.
  const stack = /^\/stack\/([^/]+)\/?$/.exec(pathname);
  if (stack) {
    const slug = decodeURIComponent(stack[1]).toLowerCase();
    if (!(VENDOR_SLUGS as string[]).includes(slug)) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
      });
    }
    if (slug !== stack[1]) {
      const url = request.nextUrl.clone();
      url.pathname = `/stack/${slug}`;
      return NextResponse.redirect(url, 308);
    }
  }

  // /compare/[a]-vs-[b]: both companies must be in the seed set, and the pair
  // has ONE canonical order — otherwise a-vs-b and b-vs-a would be two pages
  // competing for the same query with identical content.
  const cmp = /^\/compare\/([^/]+)\/?$/.exec(pathname);
  if (cmp) {
    const slug = decodeURIComponent(cmp[1]).toLowerCase();
    const parsed = parsePair(slug);
    if (!parsed) {
      return new NextResponse("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
      });
    }
    const canonical = pairKey(parsed.a, parsed.b);
    if (canonical && canonical !== cmp[1]) {
      const url = request.nextUrl.clone();
      url.pathname = `/compare/${canonical}`;
      return NextResponse.redirect(url, 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Only the public company pages; nothing else pays for this.
  matcher: ["/c/:path*", "/stack/:path*", "/compare/:path*"],
};
