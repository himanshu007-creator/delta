/**
 * ASCII as a renderer, not as clip art.
 *
 * Hand-drawn ASCII looks like hand-drawn ASCII. The good stuff — glyf.ink and
 * every decent image-to-ASCII tool — works the same way: sample a luminance
 * field once per character cell, apply gamma, and index a light-to-dark ramp.
 * Tone does the drawing, so you get gradients instead of stick figures.
 *
 * There are no image assets here. The scenes are luminance FIELDS computed
 * from maths (a sun disc with falloff, a horizon, interfering sine waves, a
 * palm silhouette), which is what gives the smooth gradients the ramp needs.
 * Being functions of time, they also animate for free.
 *
 * Two details that separate this from a naive implementation:
 *  - Monospace cells are roughly 2:1 tall, so the field is sampled with the y
 *    axis compressed or every scene comes out vertically stretched.
 *  - Luminance is gamma-corrected before indexing, or the midtones crush and
 *    the whole image reads as either soot or blank paper.
 */

// --- Ramps (light → dark) ---------------------------------------------------

export const RAMPS = {
  /** The classic. Reads well small. */
  standard: " .:-=+*#%@",
  /** 70 steps: smooth gradients, best at larger cell counts. */
  dense:
    " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  /** Blocks: heavier, more poster than photo. */
  blocks: " ░▒▓█",
  /** Quarter-tone blocks, good for dense dark scenes. */
  soft: " ·∶░▒▓█",
} as const;

export type RampName = keyof typeof RAMPS;

/**
 * Monospace glyphs are about twice as tall as they are wide, so a scene with
 * visual aspect A needs rows ≈ cols * CELL_ASPECT / A or it comes out
 * vertically stretched. Use `rowsFor()` rather than guessing.
 */
const CELL_ASPECT = 0.5;

export function rowsFor(cols: number, visualAspect = 16 / 9): number {
  return Math.max(3, Math.round((cols * CELL_ASPECT) / visualAspect));
}

export type Field = (x: number, y: number, t: number) => number;

/**
 * Reverse a ramp. Dense glyphs read as BRIGHT on a dark background and DARK on
 * a light one, so the same field must be rendered both ways and the correct
 * variant shown per theme. Without this the sun is the darkest thing on the
 * page in light mode.
 */
export function invert(ramp: string): string {
  return [...ramp].reverse().join("");
}

export type RenderOpts = {
  cols: number;
  rows: number;
  ramp?: RampName | string;
  /** >1 darkens midtones, <1 lifts them. */
  gamma?: number;
  t?: number;
  /** Multiply luminance before mapping. */
  contrast?: number;
};

/**
 * Render a luminance field to ASCII.
 * The field is sampled in a 0..1 square; the y axis is pre-compressed so the
 * result is not stretched by the cell aspect ratio.
 */
export function render(field: Field, opts: RenderOpts): string {
  const { cols, rows, t = 0, gamma = 1.1, contrast = 1 } = opts;
  const chars = (opts.ramp && RAMPS[opts.ramp as RampName]) || (opts.ramp as string) || RAMPS.standard;
  gridAspect = cols / rows;
  const last = chars.length - 1;
  const lines: string[] = [];

  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) / rows;
    let line = "";
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols;
      let v = field(x, y, t);
      v = Math.max(0, Math.min(1, v * contrast));
      v = Math.pow(v, gamma);
      line += chars[Math.round(v * last)] ?? " ";
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

// --- Field helpers ----------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Grid aspect for the render in flight, so shapes can be measured in CELLS.
 *
 * A unit of y covers far fewer cells than a unit of x (110 cols vs 29 rows is
 * ~3.8x), so a shape sized in normalized units comes out sub-pixel vertically
 * and a palm frond renders as a dashed line. Set by render().
 */
let gridAspect = 3.8;

/** Distance in cell-space: a `r` of 0.01 is the same thickness either way. */
function dist(x: number, y: number, cx: number, cy: number) {
  return Math.hypot(x - cx, (y - cy) / gridAspect);
}

// --- Scenes -----------------------------------------------------------------

const HORIZON = 0.56;
const SUN_X = 0.68;
const SUN_Y = 0.40;

/**
 * Hawaiian sunset: sun with atmospheric falloff over a horizon, a shimmering
 * reflection column, interfering swell, and a palm silhouette.
 */
export const sunsetField: Field = (x, y, t) => {
  let v: number;

  if (y < HORIZON) {
    // Smooth vertical gradient only. High-frequency detail in the sky reads
    // as static once it hits the ramp, so there is deliberately none.
    const toHorizon = 1 - (HORIZON - y) / HORIZON;
    v = 0.08 + 0.34 * Math.pow(toHorizon, 2.2);

    const d = dist(x, y, SUN_X, SUN_Y);
    v += 0.9 * (1 - smoothstep(0.05, 0.085, d)); // disc
    v += 0.5 * Math.exp(-Math.pow(d / 0.22, 2)); // corona
  } else {
    const depth = (y - HORIZON) / (1 - HORIZON);
    // Water darkens with distance from the horizon.
    v = 0.3 * (1 - Math.pow(depth, 0.8)) + 0.04;

    // The reflection column: broad, with slow glints. Low frequency on
    // purpose — this is the one place detail survives the ramp.
    const col = Math.exp(-Math.pow((x - SUN_X) / 0.13, 2));
    const glint = 0.5 + 0.5 * Math.sin(y * 26 - t * 1.6);
    v += col * glint * 0.8 * (1 - depth * 0.5);

    // A single slow swell, bent slightly across x so it is not a flat band.
    v += 0.1 * Math.sin(y * 13 + Math.sin(x * 3.2 + t * 0.5) * 1.1 + t * 0.9);
  }

  // Crisp horizon: a thin bright line where sky meets water.
  v += 0.3 * (1 - smoothstep(0, 0.012, Math.abs(y - HORIZON)));

  // --- Palm silhouette. Solid black, drawn last so nothing overwrites it.
  const trunkTop = 0.2;
  const trunkBase = HORIZON + 0.1;
  const span = trunkBase - trunkTop;

  if (y > trunkTop && y < trunkBase) {
    const k = (y - trunkTop) / span;
    const lean = 0.17 + 0.05 * k * k; // leans away from the sun
    const w = 0.007 + 0.009 * k; // thickens toward the base
    if (Math.abs(x - lean) < w) return 0.0;
  }

  // Crown: fronds radiating out and drooping under their own weight.
  const cx = 0.17;
  const cy = trunkTop;
  for (let i = 0; i < 7; i++) {
    // Fan wide and low. Fewer, longer, thinner fronds read as a palm; many
    // thick ones just merge into a blob once the ramp quantises them.
    const a = -Math.PI * 0.92 + (i / 6) * Math.PI * 0.84;
    const sway = 0.05 * Math.sin(t * 0.5 + i * 0.9);
    const len = 0.17 + 0.04 * Math.sin(i * 2.3);
    for (let s2 = 0.012; s2 < len; s2 += 0.002) {
      const k = s2 / len;
      const droop = k * k * 0.3; // gravity pulls the tips down
      const fx = cx + Math.cos(a + sway) * s2;
      const fy = cy + Math.sin(a + sway) * s2 * 1.5 + droop;
      const thick = 0.016 * (1 - k * 0.75); // taper almost to a point
      if (dist(x, y, fx, fy) < thick) return 0.0;
    }
  }

  return clamp01(v);
};

/** Quiet swell only — for dividers and calmer surfaces. */
export const swellField: Field = (x, y, t) => {
  const base = 0.45 + 0.32 * Math.sin(y * 5 + Math.sin(x * 2.4 + t * 0.6) * 1.3 + t * 0.8);
  const fine = 0.1 * Math.sin(y * 11 - x * 3.5 + t * 1.2);
  return clamp01(base + fine);
};

/** A low sun over empty water — used for empty states. */
export const calmField: Field = (x, y, t) => {
  const horizon = 0.58;
  const d = dist(x, y, 0.5, 0.44);
  let v: number;
  if (y < horizon) {
    v = 0.08 + 0.26 * (y / horizon);
    v += 0.85 * (1 - smoothstep(0.04, 0.07, d));
    v += 0.45 * Math.exp(-Math.pow(d / 0.2, 2));
  } else {
    const depth = (y - horizon) / (1 - horizon);
    v = 0.26 * (1 - depth) + 0.04;
    v += Math.exp(-Math.pow((x - 0.5) / 0.1, 2)) * (0.5 + 0.5 * Math.sin(y * 22 - t * 1.4)) * 0.7;
    v += 0.08 * Math.sin(y * 12 + Math.sin(x * 3 + t * 0.4) + t * 0.7);
  }
  v += 0.28 * (1 - smoothstep(0, 0.014, Math.abs(y - horizon)));
  return clamp01(v);
};

// --- Prerendered strings ----------------------------------------------------
// Rendered once at module load so server components can ship them as static
// text with no client work.

// Scene strings are gone: the landing art is now rendered PNGs in lib/art.ts.
// The field renderer stays because the wave rule and the live run indicator
// are still generated, and a PNG cannot animate.

/** A wave rule, wide enough to tile and drift without showing an edge. */
export function waveRule(cols = 160): string {
  return render(swellField, { cols, rows: 2, ramp: "soft", gamma: 1.4 });
}

// --- Box drawing (kept: the receipt depends on this exact behaviour) --------

export function pad(left: string, right = "", width = 44): string {
  const space = Math.max(1, width - left.length - right.length);
  return `║ ${left}${" ".repeat(space)}${right} ║`;
}

export function centre(text: string, width = 44): string {
  const lead = Math.max(0, Math.floor((width - text.length) / 2));
  const trail = Math.max(0, width - text.length - lead);
  return `║ ${" ".repeat(lead)}${text}${" ".repeat(trail)} ║`;
}

export const top = (width = 44) => `╔${"═".repeat(width + 2)}╗`;
export const bottom = (width = 44) => `╚${"═".repeat(width + 2)}╝`;
export const rule = (width = 44) => `║ ${"─".repeat(width)} ║`;

// --- Small marks ------------------------------------------------------------

export const MARK: Record<string, string> = {
  recent: "✦",
  hiring: "▲",
  customer: "◆",
  metric: "#",
  product: "▸",
  tech: "⌘",
  positioning: "·",
  warn: "⚠",
  ok: "✓",
};

/** A frame of the swell, for the live run indicator. */
export function surfFrame(tick: number): string {
  return render(swellField, { cols: 26, rows: 3, ramp: "soft", gamma: 1.3, t: tick * 0.35 });
}

export function meter(fraction: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(clamped * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}
