/**
 * The dotted world map, prepared once per server process.
 *
 * Two deliberate choices here.
 *
 * **Dots, not borders.** The map is a sampled coastline with no country
 * outlines anywhere in it. Borders are disputed — drawing them would make a
 * political claim this product has no business making — and for "this company
 * is registered here" a border adds nothing a dot does not.
 *
 * **One `<path>`, not 1,971 `<circle>`s.** A zero-length subpath with a round
 * linecap renders as a dot, so the whole landmass is one element and ~21KB of
 * highly repetitive text instead of 130KB. It also means the colour is a
 * single `stroke`, so the map inherits `currentColor` and follows the theme.
 *
 * The geo data (~700KB) stays in scripts/build-dotmap.ts and never reaches a
 * bundle: this module reads the precomputed point list.
 */

import DottedMapWithoutCountries from "dotted-map/without-countries";
import data from "./dotmap.generated.json";

const map = new DottedMapWithoutCountries({ map: data as never });

/** The map's own coordinate space, used as the SVG viewBox. */
export const MAP_W = (data as { width: number }).width;
export const MAP_H = (data as { height: number }).height;

/** Every land dot, as one path. Computed once; identical on every page. */
export const LAND_PATH: string = map
  .getPoints()
  .map((p) => `M${+p.x.toFixed(1)} ${+p.y.toFixed(1)}h0`)
  .join("");

/**
 * Project a coordinate into the map's space.
 *
 * Returns null when the point falls outside the rendered region — the map is
 * clipped below -58° latitude, and a marker drawn off-canvas would silently
 * sit on the card's edge pretending to be somewhere.
 */
export function place(lat: number, lon: number): { x: number; y: number } | null {
  const pin = map.getPin({ lat, lng: lon });
  if (!pin || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) return null;
  if (pin.x < 0 || pin.x > MAP_W || pin.y < 0 || pin.y > MAP_H) return null;
  return { x: pin.x, y: pin.y };
}
