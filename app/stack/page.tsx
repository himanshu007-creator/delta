/**
 * The vendor directory — the internal-linking hub for every /stack/[vendor]
 * page, and a single page that demonstrates the dataset at a glance.
 */

import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { isPageworthyVendor, prettyVendor, stackIndex } from "@/lib/stack-index";
import { SectionHead, ThemeToggle } from "../ui";
import { AskAbout } from "../ask";

export const metadata = {
  title: "What companies actually buy — vendor adoption from public DNS",
  description:
    "Vendor adoption across indexed companies, read from public DNS verification records. " +
    "Back-office purchases — HR, feature flags, security, AI tooling — that frontend script detection cannot see.",
  alternates: { canonical: "/stack" },
};

const pretty = prettyVendor;

export default function StackIndexPage() {
  const ix = stackIndex();
  const rows = ix.vendors.filter((v) => v.domains.length >= 2 && isPageworthyVendor(v.vendor));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <nav className="mb-10 flex items-center justify-between gap-4">
        <Link href="/" className="mono t-small no-underline">{SITE_NAME}</Link>
        <div className="flex items-center gap-3">
          <Link href="/#pricing" className="t-small no-underline">Pricing</Link>
          <ThemeToggle />
        </div>
      </nav>

      <header className="mb-10">
        <p className="eyebrow mb-2">Vendor adoption</p>
        <h1 className="t-display">What companies actually buy</h1>
        <p className="t-body muted mt-3">
          {rows.length} vendors across {ix.domainsIndexed} indexed companies, read from public DNS
          verification records. These are <strong>purchases</strong>, not page scripts — so the list
          includes the back-office tools script detection never sees.
        </p>
      </header>

      <section className="mb-10">
        <SectionHead eyebrow="Ranked" title="By number of companies" />
        <div className="card">
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map((v) => (
              <li key={v.vendor} className="flex items-baseline justify-between gap-3 min-w-0">
                <Link href={`/stack/${v.vendor}`} className="t-small no-underline truncate">
                  {pretty(v.vendor)}
                </Link>
                <span className="mono t-micro muted">{v.domains.length}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <AskAbout
        className="mb-10"
        path="/stack"
        ask="Which vendors are most widely adopted across these companies, and what does that say about where the market is spending?"
      />

      <footer className="t-small muted border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p>Public DNS records only. Generated {ix.generatedAt.slice(0, 10)}.</p>
        <p className="mt-2">
          <Link href="/">{SITE_NAME}</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/terms">Terms</Link>
        </p>
      </footer>
    </main>
  );
}
