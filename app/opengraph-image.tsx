import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * The share card, inherited by every page that does not override it.
 *
 * Deliberately one static image rather than 842 per-page ones: generating a
 * bespoke card for every vendor and comparison page would add roughly a minute
 * to a build that already takes 57s, and the text metadata does far more for
 * search and assistant discovery than the picture does. Per-page cards are a
 * later win, not a launch requirement.
 */
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fdfaf6",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 30, letterSpacing: 8, color: "#1f6f8b", textTransform: "uppercase" }}>
            {SITE_NAME}
          </div>
          <div style={{ fontSize: 68, lineHeight: 1.1, color: "#1c1917", maxWidth: 940 }}>
            Competitor intelligence with its sources attached
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 30, color: "#57534e" }}>
            Pricing tiers · vendor stack · releases · hiring · security posture
          </div>
          <div style={{ fontSize: 26, color: "#e4572e" }}>
            Every fact linked to the page it came from
          </div>
        </div>
      </div>
    ),
    size,
  );
}
