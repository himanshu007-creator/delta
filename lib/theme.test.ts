/**
 * The contrast contract, enforced.
 *
 * Pastel palettes fail for one reason: a light fill gets paired with light
 * text. They also drift the moment someone nudges a hex to "warm it up".
 * Nothing else in the suite would notice, and the result is a product that
 * looks lovely to its author and is unreadable to a chunk of its buyers.
 *
 * So this parses app/globals.css itself — not a copy of the values — and
 * asserts every pair in BOTH themes.
 *
 * Run: npx tsx lib/theme.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ART } from "./art";

const css = readFileSync("app/globals.css", "utf8");

// --- WCAG 2.x relative luminance + contrast --------------------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Pull one block's custom properties out of the stylesheet. */
function tokens(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  assert.ok(i !== -1, `missing block: ${selector}`);
  const body = css.slice(i, css.indexOf("}", i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const THEMES = {
  light: tokens(":root {"),
  dark: tokens(':root[data-theme="dark"] {'),
};

const AA_TEXT = 4.5;
const AA_LARGE = 3.0; // 24px+, or 18.5px bold
const AA_UI = 3.0;

function check(theme: string, t: Record<string, string>) {
  const need = (fg: string, bg: string, min: number, what: string) => {
    assert.ok(t[fg], `${theme}: missing ${fg}`);
    assert.ok(t[bg], `${theme}: missing ${bg}`);
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(
      ratio >= min,
      `${theme}: ${what} — ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
    );
  };

  // Body text on every surface it can land on.
  for (const bg of ["--bg", "--surface", "--surface-2"]) {
    need("--ink", bg, AA_TEXT, "body text");
    need("--ink-muted", bg, AA_TEXT, "secondary text");
  }

  // THE contract: every fill has a tested foreground partner.
  need("--on-coral", "--coral", AA_TEXT, "button label on coral");
  need("--on-ocean", "--ocean", AA_TEXT, "button label on ocean");
  need("--on-mango", "--mango", AA_TEXT, "text on mango");
  need("--on-mint", "--mint", AA_TEXT, "text on mint surface");
  need("--on-shell", "--shell", AA_TEXT, "text on shell surface");

  // Accents used as text on page surfaces (links, eyebrows, stats).
  for (const bg of ["--bg", "--surface"]) {
    need("--ocean", bg, AA_TEXT, "link / eyebrow");
    need("--coral", bg, AA_LARGE, "accent heading");
    need("--danger", bg, AA_TEXT, "error text");
    need("--warn", bg, AA_TEXT, "warning text");
  }

  // Non-text UI: borders and the focus ring must be perceivable.
  need("--border-strong", "--surface", AA_UI, "input border");
  need("--ocean", "--surface", AA_UI, "focus ring");
}

for (const [name, t] of Object.entries(THEMES)) check(name, t);

// Both themes must define the same token set, or one theme silently inherits
// the other's colour and a single element stays dark in light mode.
{
  const l = Object.keys(THEMES.light).sort();
  const d = Object.keys(THEMES.dark).sort();
  const missing = l.filter((k) => !d.includes(k));
  assert.deepEqual(missing, [], `dark theme is missing tokens: ${missing.join(", ")}`);
}

// The art-deco palette must be gone, not merely unused.
{
  for (const dead of ["--color-brass", "--color-cream", "--color-jade", "--color-ink-2"]) {
    assert.ok(!css.includes(dead), `${dead} still defined — art-deco leftovers`);
  }
  assert.ok(!css.includes("Cinzel"), "Cinzel must be gone");
}

// --- Art manifest ----------------------------------------------------------
// A half-finished art swap renders a broken image rather than failing a build,
// so the manifest is checked against what is actually on disk, and against the
// licence table. An uncredited render is a legal problem, not a cosmetic one.
{
  const credits = readFileSync("public/art/CREDITS.md", "utf8");

  for (const [key, piece] of Object.entries(ART)) {
    assert.ok(piece.src.startsWith("/art/"), `${key}: art must live under /art/`);
    assert.ok(
      existsSync(`public${piece.src}`),
      `${key}: ${piece.src} is in the manifest but not on disk`,
    );
    assert.ok(piece.width > 0 && piece.height > 0, `${key}: needs real dimensions for next/image`);
    assert.equal(typeof piece.alt, "string", `${key}: alt must be set, "" marks it decorative`);

    const file = piece.src.split("/").pop()!;
    assert.ok(
      credits.includes(file),
      `${key}: ${file} has no row in public/art/CREDITS.md — every render needs a licence trail`,
    );
  }

  assert.ok(credits.includes("Unsplash License"), "CREDITS.md must name the licence");
  assert.ok(ART.hero.alt.length > 0, "the hero is content, not decoration, so it needs real alt text");
}

// --- No orphan classes or custom properties --------------------------------
// The whole /run page once rendered with art-deco classes that had been
// deleted from the stylesheet. An invalid var() in `color` drops the
// declaration silently, so every "muted" label rendered at full ink and the
// primary CTA looked like every other button. Nothing caught it because
// nothing was looking.
{
  const definedClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)\s*[,{:]/g)].map((m) => m[1]));
  const definedVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

  // Tailwind generates its own; we only police OUR classes.
  const TAILWIND =
    /^(sm|md|lg|xl|2xl):|^(grid|flex|block|hidden|inline|text|bg|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min|max|gap|space|items|justify|self|border|rounded|shadow|opacity|overflow|relative|absolute|fixed|sticky|top|left|right|bottom|inset|z|truncate|shrink|grow|basis|font|leading|tracking|cursor|select|order|col|row|aspect|object|whitespace|antialiased|no-underline|underline|uppercase|lowercase|capitalize|container|break|list|wrap|align|visible|invisible|pointer|divide|ring|transition|duration|animate|scroll|sr)/;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
    );

  const orphanClasses: string[] = [];
  const orphanVars: string[] = [];

  for (const file of walk("app")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const raw of (m[1] ?? m[2] ?? "").split(/\s+/)) {
        const cls = raw.split("${")[0].trim();
        if (!cls || TAILWIND.test(cls) || definedClasses.has(cls)) continue;
        orphanClasses.push(`${file}: .${cls}`);
      }
    }
    for (const m of src.matchAll(/var\((--[\w-]+)/g)) {
      if (!definedVars.has(m[1])) orphanVars.push(`${file}: ${m[1]}`);
    }
  }

  assert.deepEqual(orphanClasses, [], `classes used but never defined:\n  ${orphanClasses.join("\n  ")}`);
  assert.deepEqual(orphanVars, [], `custom properties used but never defined:\n  ${orphanVars.join("\n  ")}`);
}

// --- Mobile: controls must not trigger iOS zoom ----------------------------
// Safari auto-zooms any control under 16px on focus. With the root at 15px and
// controls inheriting it, every field on /run zoomed the page.
{
  const mobile = css.slice(css.indexOf("@media (max-width: 639.98px)"));
  assert.ok(mobile.length > 0, "the mobile breakpoint must be 639.98px, not 640px: at exactly 640px Tailwind's sm: and ours both apply");
  assert.ok(
    /input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/.test(mobile),
    "mobile controls must be 16px or iOS zooms the page on every focus",
  );
  // A viewport lock would live in layout.tsx, not the stylesheet. (Checking
  // the CSS matched our own explanatory comment about not doing this.)
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.ok(
    !/maximum-scale|user-scalable\s*[=:]\s*no/.test(layout),
    "never lock the viewport: it disables pinch-zoom for everyone, which is an accessibility failure",
  );
}

const report = Object.entries(THEMES)
  .map(
    ([n, t]) =>
      `${n}: ink ${contrast(t["--ink"], t["--bg"]).toFixed(1)}:1, muted ${contrast(t["--ink-muted"], t["--bg"]).toFixed(1)}:1, coral ${contrast(t["--on-coral"], t["--coral"]).toFixed(1)}:1`,
  )
  .join("  |  ");
// The theme script mutates <html> before hydration, so the element needs
// suppressHydrationWarning — without it React discards the correction and the
// flash returns. And data-theme must NOT be hardcoded: dark mode is gated on
// :root:not([data-theme="light"]), so a fixed value kills prefers-color-scheme.
{
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const htmlTag = layout.slice(layout.indexOf("<html"), layout.indexOf(">", layout.indexOf("<html")) + 1);
  assert.ok(
    htmlTag.includes("suppressHydrationWarning"),
    "<html> needs suppressHydrationWarning — the theme script mutates it pre-hydration",
  );
  assert.ok(
    !/data-theme=["']/.test(htmlTag),
    'data-theme must not be hardcoded on <html> — it would defeat prefers-color-scheme',
  );
}

console.log(`✓ contrast contract holds — ${report}`);
