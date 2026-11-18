/**
 * Rendered ASCII art.
 *
 * Each entry is an Unsplash photograph put through the ASCII Magic engine
 * (`characters` style). Licences live in public/art/CREDITS.md, and a render
 * with no row in that table is a bug.
 *
 * These are COLOUR renders, which is why there is no light/dark pair: each one
 * carries its own background, so it sits on either theme without inverting.
 * That also halves the render budget, which matters on a free tier capped at
 * five renders a day.
 */

export type ArtPiece = {
  src: string;
  width: number;
  height: number;
  /** Empty string marks it decorative; screen readers skip it. */
  alt: string;
};

export const ART = {
  hero: {
    src: "/art/hero-pen.png",
    width: 900,
    height: 1200,
    alt: "A fountain pen resting in spilled ink beside handwriting, rendered as ASCII characters",
  },
  palm: {
    src: "/art/hero-palm.png",
    width: 857,
    height: 1200,
    alt: "",
  },
  wave: {
    src: "/art/wave.png",
    width: 1200,
    height: 900,
    alt: "",
  },
  lei: {
    src: "/art/lei.png",
    width: 1200,
    height: 800,
    alt: "",
  },
} as const satisfies Record<string, ArtPiece>;

export type ArtKey = keyof typeof ART;
