/**
 * What this project is, now that it is free and open source.
 *
 * Replaces lib/offer.ts. There is no price, no licence key and no checkout —
 * so the things a visitor needs to know are different: what it costs to run,
 * what it needs to run, and where the source is.
 *
 * The old doctrine still holds and is the reason this file is small: **every
 * number shown must be real.** Nothing here is aspirational.
 */

/** Where the source lives. Set it once; the whole site links here. */
export const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/himanshu007-creator/delta";

export const LICENSE = "MIT";

/**
 * What a deployment actually requires.
 *
 * The honest answer is "nothing", and that is the point of listing it: the app
 * runs on a bare Vercel deployment with no database and no API keys, crawling
 * live on request. Everything below is an upgrade, not a prerequisite.
 */
export const REQUIREMENTS = [
  {
    name: "Nothing",
    need: "required",
    what: "Deploy to Vercel and it works. Pages crawl public sources live on request.",
  },
  {
    name: "Postgres (Supabase free tier)",
    need: "optional",
    what: "Stores a crawl index so pages load from one query instead of ~25 requests — and keeps the change history, which is the part that cannot be re-created later.",
  },
  {
    name: "GitHub Actions",
    need: "optional",
    what: "Runs the 12-hour crawl window. Free, and the only reason history accrues at all.",
  },
  {
    name: "A model API key",
    need: "optional",
    what: "Only for reading awkward pages that resist deterministic parsing. Most sources never need one.",
  },
] as const;

/**
 * Soft rate limit.
 *
 * Abuse protection, not a product boundary: it exists so one runaway loop
 * cannot take the deployment down for everyone else. Nobody using the tool
 * normally will ever meet it.
 */
export const FAIR_USE_RPM = 120;
