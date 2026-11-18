/**
 * schema.org JSON-LD traversal, shared by every adapter that reads structured
 * markup off a page.
 *
 * Extracted from the pricing cascade because identity needs exactly the same
 * traversal over a different `@type`: pricing walks for Product/Offer,
 * identity walks for Organization/LocalBusiness. One implementation, so a fix
 * to the parser helps both.
 */

import { decodeEntities } from "./types";

export type LdNode = Record<string, unknown>;

/**
 * Every parseable ld+json block on a page.
 *
 * A malformed block is skipped rather than fatal — sites routinely ship one
 * broken script tag alongside three good ones, and losing the good ones because
 * of it would be our bug, not theirs.
 */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = decodeEntities(m[1]).trim();
    if (!body) continue;
    try { out.push(JSON.parse(body)); } catch { /* one bad block must not cost the others */ }
  }
  return out;
}

/**
 * Collect every node whose `@type` matches, at any depth.
 *
 * `@type` is legitimately either a string or an array, and the interesting
 * nodes are usually nested inside `@graph`, `offers`, `subOrganization` or
 * `mainEntity` — so this recurses rather than inspecting the top level.
 */
export function collect(root: unknown, types: readonly string[], acc: LdNode[] = []): LdNode[] {
  if (Array.isArray(root)) {
    for (const v of root) collect(v, types, acc);
    return acc;
  }
  if (root && typeof root === "object") {
    const n = root as LdNode;
    const t = n["@type"];
    const tags = Array.isArray(t) ? t : [t];
    if (tags.some((x) => typeof x === "string" && types.includes(x))) acc.push(n);
    for (const v of Object.values(n)) collect(v, types, acc);
  }
  return acc;
}

/** First non-empty string from a node field that may be a string, array or object. */
export function ldString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    for (const x of v) { const s = ldString(x); if (s) return s; }
    return null;
  }
  if (v && typeof v === "object") {
    const o = v as LdNode;
    return ldString(o.name) ?? ldString(o["@value"]) ?? ldString(o.url);
  }
  return null;
}
