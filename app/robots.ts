import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

/**
 * We crawl other people's sites politely, so our own rules are explicit.
 *
 * AI crawlers are NAMED and allowed rather than left to the `*` rule. Two
 * reasons. One of this project's own adapters measures whether a company
 * blocks GPTBot, ClaudeBot and CCBot — publishing an unambiguous answer to the
 * question we ask of everyone else is the least we can do. And being readable
 * by assistants is the distribution channel here, not a leak: the whole product
 * is public facts with their sources attached.
 *
 * `/api/` used to be disallowed on the grounds that it was metered and gated.
 * It is neither any more, and the discovery endpoint is exactly what an agent
 * should find, so only the operational routes are closed.
 */

/** Crawlers that train or answer with the content. Allowed, deliberately. */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "cohere-ai",
  "Diffbot",
  "Timpibot",
  "omgili",
] as const;

export default function robots(): MetadataRoute.Robots {
  // `/api/cron/` is operational, not content: crawling it does nothing useful
  // and it is secret-gated anyway. Everything else, including the query
  // catalogue at /api/v1, is open.
  const disallow = ["/api/cron/"];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // Named explicitly so there is no ambiguity about intent, and so a
      // future change here is a deliberate edit rather than a side effect.
      { userAgent: [...AI_AGENTS], allow: "/", disallow },
    ],
    sitemap: abs("/sitemap.xml"),
    host: abs("/"),
  };
}
