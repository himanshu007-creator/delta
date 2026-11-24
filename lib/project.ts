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
 * Deploying it, in the order you actually do it.
 *
 * Infrastructure is deliberately absent from this list. A visitor does not
 * need to know what the history is kept in, only that it starts accruing once
 * the thing is running — naming a database here made a one-click deploy read
 * like a setup chore, which is the opposite of true.
 */
export const DEPLOY_STEPS = [
  {
    step: "Fork it",
    what: "One repository, no services to sign up for, nothing to configure.",
  },
  {
    step: "Deploy to Vercel",
    what: "Import and go. Pages read public sources on request, and the API and MCP server are live immediately.",
  },
  {
    step: "Turn on the schedule",
    what: "Enable the included workflow and it starts recording twice a day. From then on it is building the history nobody can look up afterwards.",
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
