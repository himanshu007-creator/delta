import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

// Sans carries all prose. Mono is reserved for ASCII, the receipt and numbers;
// monospace body copy at one size is what made this read as a wall of text.
const sans = Plus_Jakarta_Sans({
  variable: "--font-sans-var",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono-var",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute-URL base for OG, Twitter and canonical tags. Without it Next warns
  // and falls back to localhost, which silently breaks every share preview.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    // Page titles read "Thing — DELTA" without each page repeating the brand.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  // Our own pages are the proof of the product, so make them easy to read.
  other: { "llms-txt": "/llms.txt" },
};

/**
 * Sets the theme before first paint, so there is no flash of the wrong one.
 *
 * Deliberately NOT a cookie: reading cookies would make every page dynamic
 * (the Next docs show cookie reads forcing Suspense), and the landing page
 * must stay static. localStorage plus prefers-color-scheme costs nothing.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("lede.theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning, because THEME_SCRIPT sets data-theme on this
    // element before React hydrates, and the server markup has no such
    // attribute. Without it React treats the mismatch as an error and
    // client-renders from the nearest boundary, which throws away the
    // script's correction — the exact flash the script exists to prevent.
    //
    // Next's own guide (preventing-flash-before-hydration) also hardcodes
    // data-theme="light" here. We deliberately do NOT: globals.css gates dark
    // mode on :root:not([data-theme="light"]), so a hardcoded light attribute
    // would permanently defeat prefers-color-scheme for every visitor who has
    // not explicitly chosen a theme. No attribute is the correct third state.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="relative z-10 flex-1 flex flex-col">{children}</div>
        {/* Both are no-ops off Vercel, so they cost nothing in development.
            Under profit scoring, conversion is the only number that matters,
            and optimising it blind is guesswork. */}
        <Analytics />
        <SpeedInsights />
        {/* Only rendered when an ID is set, so no tag and no consent surface
            exists until you actually configure one. */}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
      </body>
    </html>
  );
}
