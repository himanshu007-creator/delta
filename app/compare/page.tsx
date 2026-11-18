/**
 * The comparison directory — the internal-linking hub for 690 head-to-head
 * pages, grouped by category so it reads as a market map rather than a list.
 */

import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { comparablePairs, SEED, seedFor, type Category } from "@/lib/seed";
import { SectionHead, ThemeToggle } from "../ui";
import { AskAbout } from "../ask";

export const metadata = {
  title: "Head-to-head company comparisons, built from public records",
  description:
    "Side-by-side comparisons of competing companies: the vendors each one buys, published pricing, " +
    "security posture and domain history. Built from DNS, their own pages and public archives.",
  alternates: { canonical: "/compare" },
};

const CATEGORY_TITLES: Record<Category, string> = {
  "dev-infra": "Developer infrastructure",
  productivity: "Productivity and collaboration",
  "sales-marketing": "Sales and marketing",
  fintech: "Payments and fintech",
  "hr-ops": "HR, hiring and operations",
  security: "Security",
  ai: "AI",
  retail: "Retail and consumer brands",
  industry: "Industry and property",
};

export default function CompareIndexPage() {
  const pairs = comparablePairs();
  const byCat = new Map<Category, typeof pairs>();
  for (const p of pairs) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <nav className="mb-10 flex items-center justify-between gap-4">
        <Link href="/" className="mono t-small no-underline">{SITE_NAME}</Link>
        <div className="flex items-center gap-3">
          <Link href="/stack" className="t-small no-underline">Vendors</Link>
          <Link href="/#pricing" className="t-small no-underline">Pricing</Link>
          <ThemeToggle />
        </div>
      </nav>

      <header className="mb-10">
        <p className="eyebrow mb-2">Comparisons</p>
        <h1 className="t-display">{pairs.length} head-to-head comparisons</h1>
        <p className="t-body muted mt-3">
          Across {SEED.length} companies, compared within their own market. Each one shows what the
          two actually run on, what they publish, and where they differ.
        </p>
      </header>

      {[...byCat.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([cat, list]) => (
          <section key={cat} className="mb-10">
            <SectionHead eyebrow={`${list.length} comparisons`} title={CATEGORY_TITLES[cat]} />
            <div className="card">
              <ul className="flex flex-wrap gap-2">
                {list.slice(0, 60).map((p) => (
                  <li key={p.slug}>
                    <Link href={`/compare/${p.slug}`} className="pill no-underline">
                      {seedFor(p.a)?.name ?? p.a} vs {seedFor(p.b)?.name ?? p.b}
                    </Link>
                  </li>
                ))}
              </ul>
              {list.length > 60 && (
                <p className="t-small muted mt-3">…and {list.length - 60} more in this market.</p>
              )}
            </div>
          </section>
        ))}

      <AskAbout
        className="mb-10"
        path="/compare"
        ask="Which of these head-to-head comparisons would matter most to someone choosing a tool in this category right now?"
      />

      <footer className="t-small muted border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p>Public sources only. We honour robots.txt and never use LinkedIn.</p>
        <p className="mt-2">
          <Link href="/">{SITE_NAME}</Link> · <Link href="/stack">Vendors</Link> ·{" "}
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
        </p>
      </footer>
    </main>
  );
}
