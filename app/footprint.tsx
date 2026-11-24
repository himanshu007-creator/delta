/**
 * Where a company is, drawn once, at the top of its page.
 *
 * The map answers one question — "where does this company actually operate?" —
 * from two different kinds of evidence, and it keeps them visually distinct
 * because they are not equally strong:
 *
 *   • A REGISTERED country comes from a registry or a statutory disclosure.
 *     One marker, in the accent colour, with a crosshair. This is a fact.
 *   • A MARKET comes from a region-bearing locale the company publishes
 *     (en-GB, da-DK). Smaller, quieter dots. This is strong evidence of intent
 *     to sell somewhere, not proof of an office.
 *
 * It renders nothing at all when there is no placeable location. An empty
 * world map is decoration, and decoration dressed as data is worse than a gap.
 *
 * Dots, no borders: see lib/dotmap.ts.
 */

import { LAND_PATH, MAP_H, MAP_W, place } from "@/lib/dotmap";
import { COUNTRIES, countryName } from "@/lib/worldmap";

export type Footprint = {
  /** ISO code from a registry or statutory source. */
  registered: string | null;
  /** City, if a page stated one. */
  city: string | null;
  /** ISO codes implied by published locales. */
  markets: readonly string[];
  /** Which source gave us the registered country, for the caption. */
  basis: string | null;
};

export function hasFootprint(f: Footprint): boolean {
  return Boolean(f.registered) || f.markets.length > 0;
}

export function FootprintMap({ footprint: f, domain }: { footprint: Footprint; domain: string }) {
  if (!hasFootprint(f)) return null;

  const home = f.registered ? COUNTRIES[f.registered] : null;
  const pin = home ? place(home.lat, home.lon) : null;

  // Markets, minus the home country — a dot under the marker is just mud.
  const marketPins = f.markets
    .filter((iso) => iso !== f.registered && COUNTRIES[iso])
    .map((iso) => ({ iso, at: place(COUNTRIES[iso].lat, COUNTRIES[iso].lon) }))
    .filter((m): m is { iso: string; at: { x: number; y: number } } => m.at !== null);

  return (
    <figure className="m-0 mb-10">
      <div className="map-frame">
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className="map-svg"
          role="img"
          aria-label={
            home
              ? `World map marking ${countryName(f.registered!)}, where ${domain} is registered` +
                (marketPins.length ? `, and ${marketPins.length} further markets` : "")
              : `World map marking ${marketPins.length} markets ${domain} publishes for`
          }
        >
          {/* The landmass: one path, every dot a zero-length round-capped
              segment. Inherits currentColor, so it follows the theme. */}
          <path
            d={LAND_PATH}
            className="map-land"
            strokeLinecap="round"
            fill="none"
            strokeWidth="0.62"
          />

          {/* A native SVG <title> is the tooltip: it shows on hover with no
              JavaScript, and screen readers announce it as the element's
              accessible name. A custom tooltip would need both. */}
          {marketPins.map((m) => (
            <circle key={m.iso} cx={m.at.x} cy={m.at.y} r="1.4" className="map-hit">
              <title>{countryName(m.iso)} — a market they publish for</title>
            </circle>
          ))}
          {/* The visible dot carries no <title>: it has pointer-events:none,
              so its tooltip could never fire and would only duplicate the
              hit circle's in the accessibility tree. */}
          {marketPins.map((m) => (
            <circle key={`${m.iso}-dot`} cx={m.at.x} cy={m.at.y} r="0.62" className="map-market" aria-hidden />
          ))}

          {pin && (
            <g>
              {/* A full-width crosshair, not a ring: it reads as a coordinate
                  being located rather than as a pin dropped on a travel map. */}
              <line x1="0" y1={pin.y} x2={MAP_W} y2={pin.y} className="map-cross" />
              <line x1={pin.x} y1="0" x2={pin.x} y2={MAP_H} className="map-cross" />
              <circle cx={pin.x} cy={pin.y} r="1.1" className="map-pulse" />
              <circle cx={pin.x} cy={pin.y} r="1.1" className="map-pulse map-pulse-2" />
              <circle cx={pin.x} cy={pin.y} r="1" className="map-pin">
                <title>
                  {countryName(f.registered!)}
                  {f.city ? ` — ${f.city}` : ""} — where {domain} is registered
                </title>
              </circle>
            </g>
          )}
        </svg>

        <div className="map-legend">
          {home ? (
            <>
              <p className="eyebrow mb-1">Registered</p>
              <p className="t-h3 m-0">{countryName(f.registered!)}</p>
              {f.city && <p className="t-micro muted mt-1 mb-0">{f.city}</p>}
            </>
          ) : (
            <>
              <p className="eyebrow mb-1">Markets</p>
              <p className="t-h3 m-0">{marketPins.length} published</p>
              <p className="t-micro muted mt-1 mb-0">Registered country not resolved</p>
            </>
          )}
        </div>

        {marketPins.length > 0 && home && (
          <div className="map-legend map-legend-end">
            <p className="eyebrow mb-1">Also serves</p>
            <p className="t-h3 m-0">{marketPins.length}</p>
            <p className="t-micro muted mt-1 mb-0">
              {marketPins.slice(0, 4).map((m) => m.iso).join(" · ")}
              {marketPins.length > 4 ? " …" : ""}
            </p>
          </div>
        )}
      </div>

      <figcaption className="t-micro muted mt-2">
        {home ? (
          <>
            Registered country from {f.basis ?? "a statutory source"}.{" "}
          </>
        ) : null}
        {marketPins.length > 0 ? (
          <>
            Markets inferred from locales the company publishes — evidence of where it sells, not
            of an office. Only locales carrying a region are counted, so a language-only path is
            ignored.
          </>
        ) : (
          <>No market locales published.</>
        )}
      </figcaption>
    </figure>
  );
}
