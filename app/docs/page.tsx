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
import { DEPLOY_STEPS, FAIR_USE_RPM, REPO_URL } from "@/lib/project";
import { SITE_NAME, SITE_URL, abs } from "@/lib/site";
import { JsonLd } from "../jsonld";
import { SectionHead, SiteFooter } from "../ui";
import { SiteNav } from "../nav";
import { AskAbout } from "../ask";
import { LiveCode, LiveOrigin } from "../origin";

export const metadata: Metadata = {
  title: "API and MCP server",
  description:
    `Connect ${SITE_NAME} to Claude or any agent. A Model Context Protocol server and a REST API ` +
    `over the same named queries. Free, unauthenticated, and open source.`,
  alternates: { canonical: "/docs" },
  openGraph: { title: `${SITE_NAME} — API and MCP server`, url: "/docs", images: ["/opengraph-image"] },
};

/** The build-time value. <LiveCode> swaps it for the real one client-side. */
const MCP_URL = `${SITE_URL}/api/mcp`;

/**
 * A snippet whose `{ORIGIN}` placeholders resolve to wherever the reader
 * actually is — their fork, their domain, their preview, or localhost.
 */
function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="code-block">
      {label && <p className="code-label">{label}</p>}
      <pre className="code-pre">
        <code><LiveCode template={children} fallback={SITE_URL} /></code>
      </pre>
    </div>
  );
}

export default function Docs() {
  const live = QUERIES.filter((q) => q.tier === "live");
  const stored = QUERIES.filter((q) => q.tier === "stored");

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
          Streamable HTTP, stateless, <strong>no authentication</strong>. These snippets use the
          address you are reading this on — <code className="mono"><LiveOrigin fallback={SITE_URL} /></code> —
          so a fork works without editing anything. Point any MCP client at:
        </p>
        <Code>{"{ORIGIN}/api/mcp"}</Code>

        <div className="mt-6 space-y-5">
          <Code label="Claude Code">{"claude mcp add --transport http delta {ORIGIN}/api/mcp"}</Code>

          <Code label="Claude Desktop — claude_desktop_config.json">
{`{
  "mcpServers": {
    "delta": {
      "type": "http",
      "url": "{ORIGIN}/api/mcp"
    }
  }
}`}
          </Code>

          <Code label="Any client — raw JSON-RPC, to check it works">
{`curl -s {ORIGIN}/api/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'`}
          </Code>
        </div>

        <p className="t-small muted mt-5">
          No key, no account, no quota. The only thing a tool will refuse for is history a
          deployment has not recorded yet, and it says exactly that rather than returning an
          empty list.
        </p>
      </section>

      {/* --- The tools, generated. ----------------------------------------- */}
      <section className="mb-14">
        <SectionHead eyebrow="tools" title={`${QUERIES.length} queries, same names everywhere`} />

        <h3 className="t-h3 mt-6 mb-3">Current state — always available</h3>
        <div className="table-wrap">
          <table className="fact-table">
            <thead>
              <tr><th scope="col">Tool</th><th scope="col">Arguments</th><th scope="col">Returns</th></tr>
            </thead>
            <tbody>
              {live.map((q) => (
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

        <h3 className="t-h3 mt-8 mb-3">Recorded history</h3>
        <div className="table-wrap">
          <table className="fact-table">
            <thead>
              <tr><th scope="col">Tool</th><th scope="col">Arguments</th><th scope="col">Returns</th></tr>
            </thead>
            <tbody>
              {stored.map((q) => (
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

        <p className="t-small muted mt-4" style={{ maxWidth: "62ch" }}>
          Current state is read on demand, so those tools answer anywhere. History accrues only
          while a deployment is running its schedule — which is exactly why it is worth having.
          This table is generated from the server&rsquo;s own query registry, so it cannot describe
          a tool that does not exist.
        </p>
      </section>

      {/* --- REST. ---------------------------------------------------------- */}
      <section className="mb-14">
        <SectionHead eyebrow="rest" title="Or just POST to it" />
        <Code label="One named query per path">
{`curl -s {ORIGIN}/api/v1/company_dossier \\
  -H 'content-type: application/json' \\
  -d '{"domain":"adyen.com"}'`}
        </Code>
        <Code label="Recorded history">
{`curl -s {ORIGIN}/api/v1/changes_feed \\
  -H 'content-type: application/json' \\
  -d '{"domain":"adyen.com","limit":20}'`}
        </Code>
        <p className="t-small muted mt-4">
          <code className="mono">GET /api/v1</code> returns the catalogue. CORS is open, so a
          browser can call this directly from a page.
        </p>
      </section>

      {/* --- Markdown twins. ------------------------------------------------ */}
      <section className="mb-14">
        <SectionHead eyebrow="plain text" title="Every page, as Markdown" />
        <p className="t-body mb-4" style={{ maxWidth: "60ch" }}>
          Append <code className="mono">.md</code> to any public URL. Same facts, same sources, no
          markup — for an agent that just needs to read rather than query.
        </p>
        <Code>{`{ORIGIN}/c/adyen.com.md
{ORIGIN}/stack/anthropic.md
{ORIGIN}/compare/asana.com-vs-linear.app.md`}</Code>
        <p className="t-small muted mt-4">
          Each HTML page declares its twin with{" "}
          <code className="mono">&lt;link rel=&quot;alternate&quot; type=&quot;text/markdown&quot;&gt;</code>, and{" "}
          <Link href="/llms.txt">/llms.txt</Link> documents the convention. There is also a{" "}
          <Link href="/skill/SKILL.md">Claude Skill</Link>.
        </p>
      </section>

      {/* --- Deploying it, as three steps rather than a dependency list. --- */}
      <section className="section">
        <SectionHead eyebrow="run your own" title="Three steps" />
        <ol className="steps">
          {DEPLOY_STEPS.map((d, i) => (
            <li key={d.step} className="step">
              <span className="step-n" aria-hidden>{i + 1}</span>
              <div>
                <p className="t-h3 m-0">{d.step}</p>
                <p className="t-small muted mt-1 mb-0">{d.what}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={REPO_URL} className="btn btn-primary no-underline" rel="noopener">
            Source on GitHub →
          </a>
        </div>
        <p className="t-small muted mt-5 measure">
          Free and unauthenticated, with a soft limit of {FAIR_USE_RPM} requests a minute so one
          runaway loop cannot take a deployment down for everyone else.
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
