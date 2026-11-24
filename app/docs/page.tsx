/**
 * How to connect — the page a developer or an agent lands on.
 *
 * The tool table is GENERATED from lib/queries.ts, like the Skill file and
 * llms.txt, so documentation cannot drift from the server. A docs page listing
 * a tool that no longer exists is worse than no docs page.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { QUERIES } from "@/lib/queries";
import { FAIR_USE_RPM, FREE_CALLS_PER_DAY, TIERS } from "@/lib/offer";
import { SITE_NAME, SITE_URL, abs } from "@/lib/site";
import { JsonLd } from "../jsonld";
import { SectionHead, SiteFooter } from "../ui";
import { SiteNav } from "../nav";
import { AskAbout } from "../ask";

export const metadata: Metadata = {
  title: "API and MCP server",
  description:
    `Connect ${SITE_NAME} to Claude or any agent. A Model Context Protocol server and a REST API ` +
    `over the same named queries — current state free, change history on a licence key.`,
  alternates: { canonical: "/docs" },
  openGraph: { title: `${SITE_NAME} — API and MCP server`, url: "/docs", images: ["/opengraph-image"] },
};

const MCP_URL = `${SITE_URL}/api/mcp`;

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="code-block">
      {label && <p className="code-label">{label}</p>}
      <pre className="code-pre"><code>{children}</code></pre>
    </div>
  );
}

export default function Docs() {
  const free = QUERIES.filter((q) => q.tier === "public");
  const paid = QUERIES.filter((q) => q.tier === "licensed");
  const starter = TIERS.find((t) => t.slug === "starter")!;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: `${SITE_NAME} API and MCP server`,
          url: abs("/docs"),
          description: `How to connect ${SITE_NAME} to Claude or any agent.`,
          isPartOf: { "@type": "WebSite", name: SITE_NAME, url: abs("/") },
        }}
      />

      <SiteNav here="docs" />

      <header className="mb-12">
        <p className="eyebrow mb-2">Connect</p>
        <h1 className="t-display m-0">API and MCP server</h1>
        <p className="t-body muted mt-3" style={{ maxWidth: "60ch" }}>
          One set of named queries, reachable three ways: an MCP server for agents, a REST API for
          code, and a Markdown twin of every page for anything that just reads. Current state needs
          no key at all.
        </p>
      </header>

      {/* --- MCP, first, because it is the one people came for. ------------ */}
      <section className="mb-14">
        <SectionHead eyebrow="mcp" title="Add the server" />

        <p className="t-body mb-4">
          Streamable HTTP, stateless, no sign-up. Point any MCP client at:
        </p>
        <Code>{MCP_URL}</Code>

        <div className="mt-6 space-y-5">
          <Code label="Claude Code">{`claude mcp add --transport http delta ${MCP_URL}`}</Code>

          <Code label="Claude Code — with a licence key for history">
{`claude mcp add --transport http delta ${MCP_URL} \\
  --header "Authorization: Bearer YOUR-LICENCE-KEY"`}
          </Code>

          <Code label="Claude Desktop — claude_desktop_config.json">
{`{
  "mcpServers": {
    "delta": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer YOUR-LICENCE-KEY"
      }
    }
  }
}`}
          </Code>

          <Code label="Any client — raw JSON-RPC, to check it works">
{`curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'`}
          </Code>
        </div>

        <p className="t-small muted mt-5">
          Omit the header and the server still works — every free query below answers without a
          key. A licensed query returns a readable error naming the free alternative rather than
          failing silently.
        </p>
      </section>

      {/* --- The tools, generated. ----------------------------------------- */}
      <section className="mb-14">
        <SectionHead eyebrow="tools" title={`${QUERIES.length} queries, same names everywhere`} />

        <h3 className="t-h3 mt-6 mb-3">Free — no key</h3>
        <div className="table-wrap">
          <table className="fact-table">
            <thead>
              <tr><th scope="col">Tool</th><th scope="col">Arguments</th><th scope="col">Returns</th></tr>
            </thead>
            <tbody>
              {free.map((q) => (
                <tr key={q.name}>
                  <th scope="row"><code className="mono">{q.name}</code></th>
                  <td className="mono t-micro">
                    {q.params.length
                      ? q.params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ")
                      : "—"}
                  </td>
                  <td>{q.describe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="t-h3 mt-8 mb-3">Licensed — change history</h3>
        <div className="table-wrap">
          <table className="fact-table">
            <thead>
              <tr><th scope="col">Tool</th><th scope="col">Arguments</th><th scope="col">Returns</th></tr>
            </thead>
            <tbody>
              {paid.map((q) => (
                <tr key={q.name}>
                  <th scope="row"><code className="mono">{q.name}</code></th>
                  <td className="mono t-micro">
                    {q.params.length
                      ? q.params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ")
                      : "—"}
                  </td>
                  <td>{q.describe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="t-small muted mt-4">
          This table is generated from the server&rsquo;s own query registry, so it cannot describe a
          tool that does not exist.
        </p>
      </section>

      {/* --- REST. ---------------------------------------------------------- */}
      <section className="mb-14">
        <SectionHead eyebrow="rest" title="Or just POST to it" />
        <Code label="One named query per path">
{`curl -s ${SITE_URL}/api/v1/company_dossier \\
  -H 'content-type: application/json' \\
  -d '{"domain":"adyen.com"}'`}
        </Code>
        <Code label="History needs the key in a header, never a query string">
{`curl -s ${SITE_URL}/api/v1/changes_feed \\
  -H 'content-type: application/json' \\
  -H 'Authorization: Bearer YOUR-LICENCE-KEY' \\
  -d '{"domain":"adyen.com","limit":20}'`}
        </Code>
        <p className="t-small muted mt-4">
          <code className="mono">GET /api/v1</code> returns the catalogue, so discovery needs no
          licence either. Keys go in a header because query strings end up in logs, proxies and
          browser history.
        </p>
      </section>

      {/* --- Markdown twins. ------------------------------------------------ */}
      <section className="mb-14">
        <SectionHead eyebrow="plain text" title="Every page, as Markdown" />
        <p className="t-body mb-4" style={{ maxWidth: "60ch" }}>
          Append <code className="mono">.md</code> to any public URL. Same facts, same sources, no
          markup — for an agent that just needs to read rather than query.
        </p>
        <Code>{`${SITE_URL}/c/adyen.com.md
${SITE_URL}/stack/anthropic.md
${SITE_URL}/compare/asana.com-vs-linear.app.md`}</Code>
        <p className="t-small muted mt-4">
          Each HTML page declares its twin with{" "}
          <code className="mono">&lt;link rel=&quot;alternate&quot; type=&quot;text/markdown&quot;&gt;</code>, and{" "}
          <Link href="/llms.txt">/llms.txt</Link> documents the convention. There is also a{" "}
          <Link href="/skill/SKILL.md">Claude Skill</Link>.
        </p>
      </section>

      {/* --- Limits, stated plainly. ---------------------------------------- */}
      <section className="mb-14">
        <SectionHead eyebrow="limits" title="What is metered, and what is not" />
        <div className="card p-5">
          <dl className="t-small m-0 space-y-3">
            <div className="flex justify-between gap-6">
              <dt className="muted">Public pages and <code className="mono">.md</code> twins</dt>
              <dd className="m-0">Unlimited, no account</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="muted">API + MCP, no key</dt>
              <dd className="m-0">{FREE_CALLS_PER_DAY} calls/day</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="muted">API + MCP, any paid plan</dt>
              <dd className="m-0">Unmetered, fair use ({FAIR_USE_RPM}/min)</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="muted">What you actually pay for</dt>
              <dd className="m-0">Companies tracked — from ${starter.monthly}/mo</dd>
            </div>
          </dl>
        </div>
        <p className="t-small muted mt-4" style={{ maxWidth: "62ch" }}>
          Calls are not metered on a paid plan. Our cost is crawling unique companies; serving a
          read is an indexed query against data we already hold. An agent firing twenty queries to
          answer one question is the product working, not a billing event.
        </p>
      </section>

      <AskAbout
        className="mb-10"
        path="/docs"
        ask={`How would I wire ${SITE_NAME}'s MCP server into an agent, and which of its tools would I use to answer "did any competitor change price this month"?`}
      />

      <SiteFooter />
    </main>
  );
}
