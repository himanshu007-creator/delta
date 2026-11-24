"use client";

/**
 * Search across every static page.
 *
 * The index is passed in from the server rather than imported here, because
 * lib/search-index.ts reaches into the generated stack index and the seed set
 * and there is no reason to ship either to the browser twice.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Hit } from "@/lib/search-index";
import { publicDomain } from "@/lib/domain";

export function SearchBox({
  index,
  autoFocus = false,
  placeholder = "Search a company, a vendor, or any domain…",
}: {
  index: readonly Hit[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const router = useRouter();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ranking duplicated from lib/search-index's searchHits, inlined so the
  // client bundle carries the 12-line filter instead of the whole module.
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const scored: Array<{ hit: Hit; score: number }> = [];
    for (const hit of index) {
      const at = hit.q.indexOf(needle);
      if (at === -1) continue;
      scored.push({ hit, score: at === 0 ? 0 : hit.q[at - 1] === " " ? 1 : 2 });
    }
    const ranked = scored
      .sort((a, b) => a.score - b.score || a.hit.label.length - b.hit.label.length)
      .slice(0, 8)
      .map((s) => s.hit);

    /*
     * The index only holds pages that are built ahead of time, but /c/[domain]
     * takes ANY public domain and reads it live — so without this row, typing
     * a real company that is not in the seed set returned nothing and the
     * dropdown did not even open. A dead end in front of a working feature.
     *
     * `publicDomain` is the same validator the proxy and the page use, so a
     * suggestion here can never point at a domain the server would refuse.
     * It has zero dependencies by design, which is what makes it safe to
     * import into a client component.
     */
    const typed = publicDomain(needle) ?? (needle.includes(".") ? null : publicDomain(`${needle}.com`));
    if (typed && !ranked.some((h) => h.href === `/c/${typed}`)) {
      ranked.push({
        q: typed,
        label: typed,
        href: `/c/${typed}`,
        kind: "company",
        note: "look up live",
      });
    }

    return ranked;
  }, [q, index]);

  const show = open && hits.length > 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!show) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = hits[Math.min(cursor, hits.length - 1)];
      if (target) router.push(target.href);
    }
  }

  return (
    <div className="search-wrap">
      {/* role=combobox + aria-activedescendant, so the arrow keys are
          announced rather than silently moving a visual highlight. */}
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Search companies and vendors"
        role="combobox"
        aria-expanded={show}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={show ? `search-hit-${cursor}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // A click on a result fires blur first, which would unmount the list
        // before the navigation happens. The delay lets the click land.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />

      {show && (
        <ul className="search-pop" id="search-results" role="listbox">
          {hits.map((hit, i) => (
            <li key={hit.href} role="option" id={`search-hit-${i}`} aria-selected={i === cursor}>
              <Link
                href={hit.href}
                className="search-row no-underline"
                data-active={i === cursor ? "" : undefined}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  setOpen(false);
                }}
              >
                <span>{hit.label}</span>
                <span className="muted t-micro mono">{hit.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
