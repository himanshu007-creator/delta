"use client";

/** Shared chrome: theme toggle, wave dividers, ASCII scenes, section headers. */

import { useEffect, useState } from "react";
import Image from "next/image";
import { waveRule } from "@/lib/ascii";
import { SITE_NAME } from "@/lib/site";
import { REPO_URL } from "@/lib/project";
import type { ArtPiece } from "@/lib/art";

const STORAGE = "lede.theme";
type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let t: Theme | null = null;
    try {
      t = localStorage.getItem(STORAGE) as Theme | null;
    } catch {
      /* private window */
    }
    if (!t) t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(t);
    setReady(true);
  }, []);

  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      className="btn btn-sm"
      onClick={flip}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      // Render a stable label until we know, so the markup matches the server.
      style={{ visibility: ready ? "visible" : "hidden" }}
    >
      <span className="mono">{theme === "dark" ? "☾" : "☀"}</span>
      <span className="t-micro">{theme === "dark" ? "night reef" : "sunrise"}</span>
    </button>
  );
}

/** A drifting wave rule. Replaces the old art-deco double rule. */
export function WaveRule({ drift = false }: { drift?: boolean }) {
  return (
    <div className="ascii ascii-wave t-micro" aria-hidden style={{ width: "100%" }}>
      <div
        style={{
          width: "200%",
          animation: drift ? "lede-drift 24s linear infinite" : undefined,
        }}
      >
        {waveRule(220)}
      </div>
    </div>
  );
}

/**
 * A rendered ASCII scene.
 *
 * These are colour renders carrying their own background, so unlike the old
 * text art there is no light/dark pair to swap — one asset reads correctly on
 * either theme. next/image handles the WebP/AVIF conversion and sizing.
 */
export function Scene({
  art,
  className = "",
  priority = false,
  sizes = "(max-width: 1024px) 90vw, 46vw",
  rounded = true,
}: {
  art: ArtPiece;
  className?: string;
  priority?: boolean;
  sizes?: string;
  rounded?: boolean;
}) {
  return (
    <div
      className={className}
      style={{
        borderRadius: rounded ? "var(--radius)" : undefined,
        overflow: "hidden",
        border: "1px solid var(--border)",
        lineHeight: 0,
      }}
    >
      <Image
        src={art.src}
        width={art.width}
        height={art.height}
        alt={art.alt}
        priority={priority}
        sizes={sizes}
        aria-hidden={art.alt === "" ? true : undefined}
        style={{ width: "100%", height: "auto", display: "block" }}
      />
    </div>
  );
}

export function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="mb-6">
      <p className="eyebrow mb-2">{eyebrow}</p>
      <h2 className="t-h2">{title}</h2>
    </header>
  );
}

/** Progressive-disclosure answers. Keeps detail off the main scroll. */
export function Faq({ items }: { items: Array<{ q: string; a: React.ReactNode }> }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {items.map((it, i) => (
        <details key={i} style={{ borderTop: i ? "1px solid var(--border)" : undefined }}>
          <summary
            className="t-h3"
            style={{ cursor: "pointer", padding: "1rem 1.25rem", listStyle: "none" }}
          >
            {it.q}
          </summary>
          <div className="t-small muted" style={{ padding: "0 1.25rem 1.1rem" }}>
            {it.a}
          </div>
        </details>
      ))}
    </div>
  );
}


/**
 * A phone visitor landing on the desktop-shaped tool.
 *
 * Deliberately a soft gate: it explains, offers a way to carry the link to a
 * laptop, and lets them through anyway. A locked door on a tool you are asking
 * $99 for reads as hostile, and people who get blocked rarely come back.
 */
export function MobileNotice({ onContinue }: { onContinue: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="card p-6 mb-8">
      <p className="eyebrow mb-2">one small thing</p>
      <h2 className="t-h2 mb-3">This one wants a laptop</h2>
      <p className="t-body mb-4">
        You will be uploading a spreadsheet, mapping columns and reading emails side by side. It all
        works on a phone, but none of it is comfortable.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        <button className="btn btn-primary" onClick={copyLink}>
          {copied ? "Link copied" : "Copy the link for later"}
        </button>
        <a className="btn no-underline" href="mailto:?subject=LEDE&body=Open this on your laptop: https://lede.sh/run">
          Email it to myself
        </a>
      </div>
      <button className="btn btn-sm" onClick={onContinue}>
        Continue anyway
      </button>
    </div>
  );
}

/**
 * Live countdown to the deadline.
 *
 * Client-side on purpose. Computing it during prerender bakes a fixed number
 * into a static page, so "closes in 28 days" would still say 28 next week —
 * which is precisely the unfalsifiable urgency that makes a careful buyer
 * distrust everything else on the page. Next refuses to prerender `new Date()`
 * for exactly this reason, and it is right to.
 */
export function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState<{ d: number; h: number; m: number } | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = new Date(to).getTime() - Date.now();
      if (ms <= 0) return setLeft({ d: 0, h: 0, m: 0 });
      setLeft({
        d: Math.floor(ms / 86_400_000),
        h: Math.floor((ms % 86_400_000) / 3_600_000),
        m: Math.floor((ms % 3_600_000) / 60_000),
      });
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [to]);

  // Render nothing until measured, so the server and client markup agree.
  if (!left) return <span className="mono">&nbsp;</span>;
  if (left.d === 0 && left.h === 0 && left.m === 0) return <strong>closed</strong>;

  return (
    <strong className="mono" style={{ color: "var(--coral)" }}>
      {left.d}d {left.h}h {left.m}m
    </strong>
  );
}

/**
 * The shared footer.
 *
 * Two jobs. For a reader, it says what the sources are, because the brand is
 * provenance and a footer that hides the method contradicts it. For a crawler
 * and an assistant, it is the internal-linking hub that makes the generated
 * pages reachable from the root — including /llms.txt and the sitemap, which
 * is how an assistant finds the dataset at all.
 */
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t pt-10 pb-12" style={{ borderColor: "var(--border)" }}>
      <div className="grid gap-8 sm:grid-cols-4">
        <div>
          <p className="eyebrow mb-3">Explore</p>
          <ul className="space-y-2 list-none p-0 m-0">
            <li><a className="foot-link" href="/stack">Vendor adoption</a></li>
            <li><a className="foot-link" href="/compare">Head-to-head</a></li>
            <li><a className="foot-link" href="/docs">API &amp; MCP</a></li>
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-3">For machines</p>
          <ul className="space-y-2 list-none p-0 m-0">
            <li><a className="foot-link" href="/llms.txt">llms.txt</a></li>
            <li><a className="foot-link" href="/sitemap.xml">sitemap.xml</a></li>
            <li><a className="foot-link" href="/robots.txt">robots.txt</a></li>
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-3">Project</p>
          <ul className="space-y-2 list-none p-0 m-0">
            <li><a className="foot-link" href={REPO_URL} rel="noopener">Source ↗</a></li>
            <li><a className="foot-link" href="/privacy">Privacy</a></li>
            <li><a className="foot-link" href="/terms">Terms</a></li>
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-3">Method</p>
          <p className="t-micro muted m-0">
            Public records only, every fact linked to its source. Never a bypassed block,
            never LinkedIn, never a profile of a person. Free and MIT licensed.
          </p>
        </div>
      </div>

      {/* ponytail: no copyright year. new Date() in a client component is an
          unstable value at prerender, and a year adds nothing a reader needs —
          the refresh cadence is the fact worth stating. */}
      <p className="t-micro muted mt-10 mb-0">
        {SITE_NAME} · Refreshed twice daily at 00:00 and 12:00 UTC
      </p>
    </footer>
  );
}
