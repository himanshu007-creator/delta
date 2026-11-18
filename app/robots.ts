import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

/**
 * We crawl other people's sites politely, so our own rules are explicit.
 *
 * AI crawlers are allowed on purpose: the whole product is "facts with their
 * sources attached", and being readable by assistants is a distribution channel
 * (GEO), not a leak. The API is disallowed because it is metered and gated —
 * crawling it would only generate 402s.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
    ],
    sitemap: abs("/sitemap.xml"),
    host: abs("/"),
  };
}
