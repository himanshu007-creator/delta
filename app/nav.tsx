/**
 * One navigation, used by every page.
 *
 * Six near-identical navs had drifted apart: the company page offered only
 * "Pricing", so the single most likely next move — look at another company —
 * meant going back to the home page first. Every destination the product has
 * is now reachable from everywhere, and `here` marks the current section so a
 * reader can tell where they are.
 *
 * The search box is the point. It is what makes a click justified: you are
 * never more than one keystroke from the company or vendor you actually came
 * for, from any page.
 */

import Link from "next/link";
import { SEARCH_INDEX } from "@/lib/search-index";
import { SITE_NAME } from "@/lib/site";
import { SearchBox } from "./search";
import { ThemeToggle } from "./ui";

export type Section = "companies" | "vendors" | "compare" | "docs" | "pricing" | null;

const LINKS: Array<{ href: string; label: string; key: Section }> = [
  { href: "/c", label: "Companies", key: "companies" },
  { href: "/stack", label: "Vendors", key: "vendors" },
  { href: "/compare", label: "Compare", key: "compare" },
  { href: "/docs", label: "API & MCP", key: "docs" },
  { href: "/#pricing", label: "Pricing", key: "pricing" },
];

export function SiteNav({ here = null, search = true }: { here?: Section; search?: boolean }) {
  return (
    <nav className="nav-sticky mb-10" aria-label="Primary">
      <div className="nav-row">
        <Link href="/" className="mono t-small no-underline nav-brand">{SITE_NAME}</Link>

        {search && (
          <div className="nav-search">
            <SearchBox index={SEARCH_INDEX} placeholder="Jump to a company or vendor…" />
          </div>
        )}

        <div className="nav-links">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="t-small no-underline nav-link"
              // aria-current is the accessible half of the visual marker; a
              // colour change alone does not tell a screen reader anything.
              aria-current={here === l.key ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
