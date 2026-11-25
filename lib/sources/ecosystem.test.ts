/**
 * Integration catalogue extraction.
 *
 *   npx tsx lib/sources/ecosystem.test.ts
 */

import assert from "node:assert/strict";
import { ecosystemFacts, integrationSlugs } from "./ecosystem";

// --- real catalogue shapes ----------------------------------------------
{
  const locs = [
    "https://linear.app/integrations/slack",
    "https://linear.app/integrations/github",
    "https://linear.app/integrations/figma",
    "https://linear.app/integrations/vs-code",
  ];
  assert.deepEqual(integrationSlugs(locs, "linear.app"), ["figma", "github", "slack", "vs-code"]);

  const f = ecosystemFacts(locs, "linear.app", "https://linear.app/sitemap.xml");
  assert.equal(f.find((x) => x.path === "ecosystem.integrations.count")?.value, 4);
  for (const x of f) assert.ok(x.sourceUrl);
}

// --- navigation is not a catalogue entry --------------------------------
{
  /*
   * Category and tag pages are filters. Counting them makes a site with a
   * good taxonomy look like it has more partners than it does.
   */
  const locs = [
    "https://a.com/integrations",
    "https://a.com/integrations/category/crm",
    "https://a.com/integrations/all",
    "https://a.com/integrations/page/2",
    "https://a.com/integrations/slack",
  ];
  assert.deepEqual(integrationSlugs(locs, "a.com"), ["slack"]);
}

// --- the word is not the path -------------------------------------------
{
  // An article ABOUT integrations is not an integration.
  assert.deepEqual(integrationSlugs(["https://a.com/blog/our-integrations-strategy"], "a.com"), []);
  // The index page alone is not an entry.
  assert.deepEqual(integrationSlugs(["https://a.com/integrations"], "a.com"), []);
  // Their own brand is not a third-party integration.
  assert.deepEqual(integrationSlugs(["https://acme.com/integrations/acme"], "acme.com"), []);
}

// --- sub-pages collapse into their parent entry -------------------------
{
  const locs = [
    "https://a.com/integrations/slack",
    "https://a.com/integrations/slack/setup",
    "https://a.com/integrations/slack/faq",
  ];
  assert.deepEqual(integrationSlugs(locs, "a.com"), ["slack"], "an entry must be counted once");
}

// --- bounded --------------------------------------------------------------
{
  const many = Array.from({ length: 400 }, (_, i) => `https://a.com/integrations/p${String(i).padStart(3, "0")}`);
  const f = ecosystemFacts(many, "a.com", "u");
  assert.equal(f.find((x) => x.path === "ecosystem.integrations.count")?.value, 400);
  assert.equal(String(f.find((x) => x.path === "ecosystem.integrations.sample")?.value).split(",").length, 60);
  assert.deepEqual(ecosystemFacts([], "a.com", "u"), []);
}

console.log("✓ ecosystem: catalogue entries only, filters and articles refused, sub-pages collapsed");
