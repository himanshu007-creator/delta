/**
 * Workforce classification, audited against a real job board.
 *
 * Every expectation below was checked by reading all 30 of Linear's postings
 * by hand. That matters because a classifier tested on invented titles proves
 * only that the regexes compile — the failures here were all produced by real
 * titles that two buckets could plausibly claim.
 *
 *   npx tsx lib/sources/workforce.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyFunction, classifySeniority, workforceFacts } from "./workforce";
import type { Fact } from "./types";

const board = JSON.parse(
  readFileSync(new URL("./fixtures/ats-ashby-linear.json", import.meta.url), "utf8"),
) as { jobs: { title?: string; department?: string; location?: string }[] };

const rows = board.jobs.map((j) => ({
  title: j.title ?? "",
  location: j.location ?? "",
  team: j.department ?? "",
}));
const val = (f: Fact[], p: string) => f.find((x) => x.path === p)?.value;

// --- the orderings that were wrong, each from a real posting -------------
{
  /*
   * REGRESSION: a bare `product` token tested early swallowed six of thirty
   * roles. "Product Support Specialist" is support and "Product Marketing
   * Manager" is marketing; neither is a product hire.
   */
  assert.equal(classifyFunction("Product Support Specialist, APAC", "GTM"), "operations");
  assert.equal(classifyFunction("Product Marketing Manager", "Product"), "marketing");

  // An engineer filed under a department called Product is still an engineer.
  assert.equal(classifyFunction("Senior / Staff Product Engineer", "Product"), "engineering");
  assert.equal(classifyFunction("Senior / Staff Fullstack Engineer", "Product"), "engineering");

  // ...but a manager of product is not.
  assert.equal(classifyFunction("Product Manager", "Product"), "product");
  assert.equal(classifyFunction("Senior / Staff Product Designer", "Product"), "product");

  /*
   * REGRESSION: `growth` is a marketing token and "Account Executive" is a
   * sales title. Marketing tested first made every growth AE a marketer.
   */
  assert.equal(classifyFunction("Account Executive, Growth", "GTM"), "sales");
  assert.equal(classifyFunction("Account Executive, Enterprise", "GTM"), "sales");

  /*
   * REGRESSION: `gtm` as a sales token filed "Field Marketing Manager" and a
   * "Production Designer" as salespeople purely by department. A department
   * name is weaker evidence than a job title, so it is not a token at all.
   */
  assert.equal(classifyFunction("Field Marketing Manager", "GTM"), "marketing");
  assert.equal(classifyFunction("Production Designer", "GTM"), "product");

  // Leadership outranks the discipline it names.
  assert.equal(classifyFunction("Head of Engineering", "Engineering"), "leadership");
  assert.equal(classifyFunction("VP of Sales", "Sales"), "leadership");
  assert.equal(classifyFunction("Director, Finance", "Finance"), "leadership");

  // Genuinely ambiguous stays ambiguous rather than being forced.
  assert.equal(classifyFunction("Creative Producer", "GTM"), "other");
}

// --- seniority is coarse on purpose --------------------------------------
{
  assert.equal(classifySeniority("Senior / Staff Fullstack Engineer"), "staff");
  assert.equal(classifySeniority("Senior Product Manager"), "senior");
  assert.equal(classifySeniority("Head of Engineering"), "leadership");
  assert.equal(classifySeniority("Engineering Intern"), "entry");

  // No marker must NOT become "mid". We observed an absence, not a level.
  assert.equal(classifySeniority("Product Engineer"), "unspecified");
}

// --- the whole board, as a reader would see it ---------------------------
{
  const url = "https://api.ashbyhq.com/posting-api/job-board/linear";
  const facts = workforceFacts(rows, url);

  assert.equal(rows.length, 30, "the fixture must be the board that was audited");
  assert.equal(val(facts, "hiring.function.engineering"), 9);
  assert.equal(val(facts, "hiring.function.product"), 6);
  assert.equal(val(facts, "hiring.function.operations"), 5);
  assert.equal(val(facts, "hiring.function.sales"), 4);
  assert.equal(val(facts, "hiring.function.marketing"), 4);
  assert.equal(val(facts, "hiring.function.other"), 2);
  assert.equal(val(facts, "hiring.focus"), "engineering");

  // The buckets must account for every posting, or the split silently lies.
  const total = facts
    .filter((f) => f.path.startsWith("hiring.function."))
    .reduce((n, f) => n + Number(f.value), 0);
  assert.equal(total, rows.length, "every posting must land in exactly one function");

  const senTotal = facts
    .filter((f) => f.path.startsWith("hiring.seniority."))
    .reduce((n, f) => n + Number(f.value), 0);
  assert.ok(senTotal <= rows.length, "seniority buckets must not double-count");

  // `other` carries full confidence: we are certain we could NOT classify it.
  assert.equal(facts.find((f) => f.path === "hiring.function.other")!.confidence, 1);
  // A classified bucket is a judgement and must say so.
  assert.ok((facts.find((f) => f.path === "hiring.function.engineering")!.confidence ?? 1) < 1);

  for (const f of facts) assert.ok(f.sourceUrl, `${f.path} needs a source`);

  // An empty board says nothing rather than emitting a row of zeroes.
  assert.equal(workforceFacts([], url).length, 0);
}

console.log("✓ workforce: 30 real postings classified, title beats department, nothing forced into a bucket");
