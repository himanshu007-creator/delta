# DELTA

**Competitor change intelligence, with its sources attached.**

Tracks what companies publish — pricing tiers, vendor stack, releases, hiring,
security posture, legal entity — and what changed. Built from public records
only. Every fact stores the URL it came from and a short quote, so you can
check it.

Free, MIT licensed, and deployable with **no configuration and nothing to sign
up for**. The MCP server and REST API need **no authentication at all**.

```bash
claude mcp add --transport http delta https://your-deployment.vercel.app/api/mcp
```

---

## Why it exists

Competitor monitoring splits into two unhelpful halves. Generic change
detection (Visualping, Distill, ~$10–15/mo) tells you *pixels changed*.
Enterprise competitive intelligence (Crayon, Klue) tells you what it means and
costs around $30,000/year. The middle is empty.

The useful observation is that **current state is commoditised and history is
not.** Anyone can open a competitor's pricing page right now. Knowing they
raised the middle tier 20% on a Tuesday, moved SSO to Enterprise, and did it the
same week their hiring stopped requires that something was watching. That record
cannot be bought afterwards — it only exists if you started.

So the public pages give away the present, and running the crawl is how you
accrue the past.

---

## What it reads

**38 source adapters**, across 13 modules, all public:

| Module | Examples |
|---|---|
| Pricing | Tier names, monthly **and** annual prices, per-seat basis, product lines |
| Vendor stack | Public DNS verification records — back-office purchases |
| Product & releases | `llms.txt`, `openapi.json`, changelogs, npm/PyPI versions |
| Unannounced signals | Certificate transparency, sitemap diffs, new subdomains |
| Hiring & org | Greenhouse / Lever / Ashby boards, roles by team and city |
| Corporate | GLEIF, statutory footers, Impressum, VAT identifiers |
| Reliability & security | Statuspage incidents, OpenSSF Scorecard, DMARC posture |
| Adoption & scale | npm, PyPI, Docker Hub, Homebrew, VS Code, ecosyste.ms |
| Reviews & ratings | App Store, WordPress.org, Firefox AMO, VS Code Marketplace |
| Attention | Tranco rank, Wikipedia pageviews, published locales |

Cadences are mixed on purpose — 11 adapters run every 12 hours, 8 daily, 14
weekly, 5 monthly — so breadth stays cheap. A tech company resolves ~36
adapters; a domain-only company (a retailer, a property firm) still resolves 19.

### The one nobody else has

**Public DNS TXT records expose a company's actual purchased SaaS stack.**
BuiltWith and Wappalyzer see frontend scripts. This sees back-office
purchases — HR, feature flags, security, cap table, AI tooling:

```
figma.com → 1password, adobe, anthropic, atlassian, cursor, docusign, dropbox,
            launchdarkly, linear, mongodb, openai, segment, stripe, twilio, wiz…
```

One DNS query, free, perfectly diffable. A new record means they just bought
something.

---

## Quick start

```bash
git clone https://github.com/himanshu007-creator/delta
cd delta
npm install
npm run build && npx next start
```

That is the whole setup. No `.env` needed — pages read public sources on
request. **Note:** `npm start -p 3000` does *not* work (npm passes the port as a
directory); use `npx next start -p 3000`.

### Deploy

Push to GitHub and import into Vercel. Nothing to configure. The MCP endpoint,
the docs snippets and the Markdown twins all resolve to **your** deployment's
host automatically — there is no URL to edit.

### Turn on recording

Current state is read on demand and needs nothing. **History** only exists
where a deployment has been recording, which is what makes it worth having —
it cannot be bought or back-dated later.

Enable the included GitHub Actions workflow and it records twice a day. The
schema and the scripts it needs are in `supabase/` and `scripts/`; see
`.env.example`, where every variable is optional and labelled.

The first run records **zero** changes, and that is correct — a fact's first
observation is not a change, or every newly tracked company would look like it
changed everything on day one. Changes start on the second window.

---

## For agents

This is the main way in. Everything below is free and unauthenticated.

### MCP server

Streamable HTTP, stateless, 12 tools, no key:

```bash
claude mcp add --transport http delta https://your-deployment/api/mcp
```

```json
{
  "mcpServers": {
    "delta": { "type": "http", "url": "https://your-deployment/api/mcp" }
  }
}
```

Four tools read current state and answer anywhere; eight read recorded history
and say so plainly where a deployment has none yet, rather than returning an
empty list.

### REST

```bash
curl -s https://your-deployment/api/v1/company_dossier \
  -H 'content-type: application/json' \
  -d '{"domain":"adyen.com"}'
```

`GET /api/v1` returns the catalogue. CORS is open.

### Markdown twins

Append `.md` to any public URL for the same facts with no markup:

```
/c/adyen.com.md     /stack/anthropic.md     /compare/asana.com-vs-linear.app.md
```

Each HTML page declares its twin with `<link rel="alternate" type="text/markdown">`,
and `/llms.txt` documents the convention. There is a Claude Skill at
`/skill/SKILL.md`.

---

## How it is built

| | |
|---|---|
| Framework | Next.js 16.4.6, App Router, React 19.3, **Cache Components** |
| Recording | Optional, and gated at every call site — the app serves without it |
| Pages | 953 prerendered (111 companies, 152 vendors, 690 comparisons) |
| Tests | 12 suites, no framework — plain `node:assert` run by `tsx` |

### The adapter contract

Sources are **data, not code**. Each is 10–25 lines against one interface, so
breadth is cheap and every adapter is independently testable:

```ts
{
  kind: "adoption.npm",
  module: "11. Adoption & scale",
  cadence: "12h",
  url: (c) => c.npm ? `https://api.npmjs.org/downloads/range/last-month/${c.npm}` : null,
  extract: (j) => [{ path: "adoption.npm.monthly", value: sum(j.downloads) }],
}
```

`url()` returning `null` means *not applicable* — a company with no npm package
simply has no npm surface, silently. One shared fetcher supplies retries,
`Retry-After`, content hashing, byte caps and error containment, so no adapter
reimplements them.

### Deterministic first, model last

Most windows cost nothing. A surface is hashed; unchanged content short-circuits
before any parsing. Prices come from regex and structured data, versions from
registries, jobs from ATS JSON. A model is a last resort for an awkward page,
and a deployment without a key just skips that step.

### Pricing extraction is a cascade

Ordered by precision, and **which layer answered is recorded as a fact**, so a
reader can tell whether a number was read or inferred:

1. schema.org `Offer` + `UnitPriceSpecification` — exact (monday.com publishes 16)
2. Framework payloads — `__NEXT_DATA__`, RSC flight data
3. Text-window scanning, with guards
4. Screenshot + vision model

---

## Principles, and what they cost

These are enforced in code and in tests, not just stated.

**Every fact carries its source.** A value with no URL and no quote is not
published. Confidence below 0.85 is captioned on the page.

**Under-resolve rather than mis-attribute.** GLEIF's name filter is a *contains*
search, so querying "Stripe" returns a Belgian company literally named STRIPE
while the real Stripe, Inc. falls off the truncated page. Taking the exact match
put Belgium and a 2007 incorporation date on Stripe's page. Resolution is now
corroborated — sole candidate, a single-country group, or ccTLD agreement — and
an uncorroborated match becomes an explicitly unverified *lead* that never
reaches the headline or the map. This costs real true positives. It is still the
right trade.

**Our parser changing is not the world changing.** Facts record the extractor
version that produced them. Improving the nonce filter once wrote 151 rows to
`changes`, as though 70 companies had altered their vendor list on a day none of
them had. A value that differs across versions now updates silently.

**No bypassed blocks, ever.** G2, Capterra, TrustRadius and Reddit block
automated access, so they are not scraped — directly or through a provider that
would do it for you. LinkedIn is never touched. Where a source is closed, the
page says so instead of guessing.

**Aggregated to the company, never to a person.** "Three tribunal decisions in
two years", not a claimant's name. No people search, and no enriching an officer
name across sources. That line is what separates competitive intelligence from a
surveillance product.

**Borders are not drawn.** The footprint map is a sampled coastline of dots with
no country outlines, because borders are disputed and a dot showing where a
company is registered makes no political claim.

---

## Repository map

```
app/
  c/[domain]/      company dossier — the main page
  stack/[vendor]/  who uses a given vendor, from DNS
  compare/[pair]/  head-to-head, differences only
  docs/            API and MCP documentation
  md/[...path]/    Markdown twin of every page
  api/mcp/         MCP server (JSON-RPC, no SDK)
  api/v1/[query]/  REST, one named query per path
  api/cron/window/ the 12-hour crawl window
lib/
  sources/         38 adapters + the contract and runner
  queries.ts       the named-query registry — the only way data leaves
  interpret.ts     facts → sentences a human would say
  store.ts         PostgREST client; optional, fails soft
  dotmap.ts        the dotted world map
scripts/           seed, crawl, index builders, source probes
supabase/          schema.sql — tables, RPCs, row-level security
```

### Running the tests

```bash
npm test        # 12 suites, ~seconds, no network
npm run build   # also regenerates route types
```

The tests are unusual on purpose: several assert against **source text** rather
than behaviour, because the invariants that matter most here are structural —
that the SSRF guard is delegated and not reimplemented, that a change is never
recorded across extractor versions, that no client component imports the server
store. Those cannot be checked by calling a function.

---

## Status

Working: the crawl, the store, 953 prerendered pages, the MCP server, the REST
API, Markdown twins, the Claude Skill.

Not built yet, and the code says so rather than returning empty results: media
perception (GDELT bulk ingestion), mentions feed, unannounced-signal history,
category trends.

## Licence

MIT. See `LICENSE`.
