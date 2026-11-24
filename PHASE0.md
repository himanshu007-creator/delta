# Phase 0 — source verification results

Probed 2026-11-18 with `scripts/probe-sources.ts`. **Observed fact, not
documentation.** Everything the plan assumed from third-party blog posts is
either confirmed or corrected below.

## Confirmed — build on these

| Source | Observed |
|---|---|
| **Direct fetch of pricing pages** | 4/4 returned 200 with **server-rendered prices**: notion.so 8 prices/395kb, linear.app 39/809kb, vercel.com 1542/1249kb, figma.com 22/2532kb. **The JS-rendering fear was overblown** — no headless browser needed for these. |
| **Wayback CDX** | **82 monthly snapshots of notion.so/pricing, 2017-10 → 2026-08.** Nine years. The back-fill thesis is confirmed and better than planned. 4.0s per query. |
| **ATS JSON** | **6/7 resolved by guessing the board token = company name.** notion→Ashby 167 jobs, figma→GH 144, vercel→GH 87, linear→Ashby 33, stripe→GH 789, ramp→GH 1. 86% hit rate with zero discovery work. |
| **sitemap.xml / robots.txt** | linear.app: 1027 URLs, robots 7 lines. Fine for new-URL detection. |
| **HN Algolia** | 29,857 hits for "notion", points + titles. 0.5s, no auth. |
| **GitHub releases** | 3 latest releases w/ tag + date. 0.6s unauth (60/hr limit — use a token). |
| **npm registry** | 4041 versions of `next` with timestamps. Release cadence is free. |
| **iTunes Search + reviews RSS** | Notion v1.7.354, **4.77★ / 90,740 ratings**, RSS returned **50 reviews**. Official, no key. This is real review data, legitimately. |
| **Wikipedia pageviews** | 93 days of daily views. 0.6s. |
| **Stack Exchange API** | Works; **quota 300/day** per IP (observed `quota_max: 300`). |
| **Tranco** | notion.so rank 2152, daily series. 9.4s (slow). |
| **Cert Spotter** | **100 issuances returned** — and it is the working substitute for crt.sh. |

## Corrected — plan was wrong

### GDELT DOC 2.0 API is NOT usable for polling ⚠️ Phase 1 impact

- Every request takes **10–14 seconds**.
- Returns **429 with a plain-text body**, not JSON: `"Please limit requests to
  one every 5 seconds or contact ... All high-traffic users should switch to our
  ngrams dataset"`. A naive `JSON.parse` throws.
- Honouring 5s spacing was **not enough** — 17s between requests still 429'd,
  and after sustained probing a single request following a 35s cooldown still
  429'd. The limit is cumulative/IP-reputational, not a simple interval.
- `mode=artlist` succeeded where `mode=timeline*` failed, so timeline queries
  appear more expensive.

**Correction:** GDELT's own error message states the intended path — **ingest the
bulk GDELT dataset (ngrams / GKG exports) and query it locally** rather than
calling the API per company. This is strictly better for us anyway:

- It is what GDELT explicitly asks high-traffic users to do.
- Unlimited local queries instead of ~1 per 5s shared across all customers.
- **We hold the parsed corpus** instead of proxying an API — a real moat rather
  than a thin wrapper, and exactly what ClickHouse exists for.
- Storage stays bounded by filtering at ingest: stream each export, keep only
  rows mentioning a tracked company, discard the rest. Volume then scales with
  our watchlist, not with global news volume (GKG raw is hundreds of GB/year and
  would not fit Tinybird's 10 GB free tier unfiltered).

**Action:** media perception moves out of Phase 1's six sources. Phase 1 ships
pricing, home, changelog, blog and jobs. GDELT bulk ingestion becomes its own
task, sized properly, in Phase 5.

### crt.sh — failed exactly as predicted
HTTP **502** on the first call. **Cert Spotter works (100 issuances)** and
becomes the primary, not the fallback.

### Statuspage — endpoint convention is right, host guessing is not
`www.githubstatus.com/api/v2/status.json` → 200. But `status.stripe.com` → 404
and `www.notionstatus.com` → DNS failure. The `/api/v2/status.json` convention is
sound; **the status host must be discovered** (sitemap, homepage footer link, or
`<name>.statuspage.io`), not guessed. Phase 5.

### Subprocessor pages — URL guessing does not work
`notion.com/subprocessors` → 401, `linear.app/docs/subprocessors` → 404,
`vercel.com/legal/subprocessors` → 404. There is no standard path. Must be
discovered from the sitemap or privacy-page links. Phase 5, and lower value than
assumed.

### Bluesky public API — needs auth
`public.api.bsky.app/.../searchPosts` → **403**. Dropped unless we add an app
password. Low priority.

### Common Crawl — index server is overloaded
`collinfo.json` → 200 with **129 crawls** (latest `CC-MAIN-2026-43`), but the
CDX query returned **504** after 11s. Matches their "do not overload the URL
index server" warning. Use the **columnar Parquet index on S3** for any real
work, not the CDX endpoint. Phase 5.

## Not yet verified

- **SerpAPI** — skipped deliberately; costs credits. Needs `SERPAPI_KEY` to
  confirm whether `site:g2.com` actually exposes rating + review count in
  `rich_snippet`. **This is the one remaining assumption behind the review
  module** and must be tested before that module is promised anywhere.
- **Groq / Gemini / Workers AI real limits** — read from each console, not blogs.
- **Tinybird under our query shape** — 1 thread, query rate 10.
- **Pricing-page extraction accuracy** — the 50-page fixture test.

## Net effect on the plan

Phase 1's source list drops GDELT and becomes **five**: pricing, home,
changelog, blog, jobs. Everything else is confirmed working or correctly
deferred. The two load-bearing claims — **nine years of free pricing history**
and **86% job-board resolution** — both held up.

---

# Phase 0b — additional free sources (probed 2026-11-18)

`scripts/probe-extra.ts`. **12/16 usable.** Headline find first.

## ⭐ `/llms.txt` — promote into Phase 1

| Observed | |
|---|---|
| Adoption | **14/18** major SaaS: stripe 68kb, slack 40kb, hubspot 35kb, cloudflare 17kb, vercel 15kb, zapier 14kb, linear 11kb, resend 10kb, intercom 10kb, monday 10kb, notion 7kb, asana 6kb, clerk 6kb, supabase 3kb. (404: anthropic, openai, figma, airtable) |
| Diff stability | **byte-identical** across two fetches 3s apart (linear.app, 11,672 b). No timestamps, nonces or build hashes. |
| History | **50 Wayback snapshots of stripe.com/llms.txt, 2025-06 → 2026-05.** Back-fillable. |

Why this beats the changelog as a product-change source:

- It is the company's own **curated, machine-readable product summary**, published
  deliberately for machine consumption. Using it is sanctioned by design.
- Structured markdown → **the diff needs no LLM**, which directly relieves the
  Groq token ceiling that constrains the whole architecture.
- A homepage HTML diff is mostly A/B tests, nonces and build hashes. This is pure
  product signal, authored by the vendor.
- It is a 2024–25 convention and essentially nobody is monitoring it.

**Phase 1 source list becomes six: pricing, llms.txt, home, changelog, blog, jobs.**

## Verified working — Phase 5 additions

| Source | Observed | Value |
|---|---|---|
| **`/openapi.json`** | linear.app 23kb, vercel.com **12 MB** | new API endpoints ship before the blog post |
| **WordPress.org plugin API** | WooCommerce **7,000,000 installs, 90/100 from 4,833 ratings**, v11.3.0 | official installs + ratings + changelog |
| **Firefox AMO API** | **526,444 daily users, 4.08★/3,226** | official extension users + ratings + versions |
| **VS Code Marketplace** | Copilot **74,926,123 installs, 4.08** | devtool adoption + ratings |
| **Chrome Web Store** | **40,000,000 users, 3.9** | in the HTML; no API, so treat as fragile |
| **npm downloads** | `next` **371.4M/month**, 30-day series | adoption curve |
| **pypistats** | `requests` **1,496,666,327 last month** | same for Python |
| **Docker Hub** | postgres **12.5B pulls**, 15,056 stars | infra adoption |
| **Homebrew analytics** | 22,307 formulae ranked, 30d | CLI/desktop adoption |
| **SEC EDGAR** | efts full-text 200; browse-edgar 200 | every filing mentioning a competitor; XBRL financials |
| **Wikidata** | Notion Labs = Q89269703, 11 properties | founded, HQ, parent, headcount |

**This also rebuilds the review-coverage story without touching G2.** App Store,
WordPress.org, Firefox AMO, VS Code Marketplace, Chrome Web Store and Steam are
all official or public rating sources with real counts. "Reviews everywhere"
is deliverable legitimately — just not from G2/Capterra, which stay search-API-only.

## Needs more work

- **USPTO trademarks** — returned 200 but the record count did not parse; the
  current path is the newer Open Data API and needs a free key. **High value
  (unannounced product names, same scoop class as cert transparency).** Worth one
  focused session in Phase 5.
- **SmartRecruiters / Workable / BambooHR** — "none resolved", but the test
  company slugs were guesses, so this is unproven rather than broken. Retry with
  verified slugs. Marginal anyway: Greenhouse/Lever/Ashby already hit 6/7.
- **Podcastindex** — 403; free but needs key + HMAC auth. Defer.

---

# Phase 0c — deep GitHub + aggregator research (probed 2026-11-18)

## GitHub: we were using ~5% of it

All verified live on `vercel/next.js` / `cli/cli` / `orgs/vercel`, unauthenticated.

| Metric | Observed | Why it is intelligence |
|---|---|---|
| **License + `archived`** | `MIT`, `archived=false` | ⭐ **A licence change is a business-model change.** HashiCorp→BSL, Redis→RSAL, Elastic/MongoDB→SSPL all made headlines. `archived=true` = product sunset. |
| **Commit activity, 52 weeks** | `[189, 212, 230, 134]` last 4 wks | ⭐ **Engineering velocity as a time series** — accelerating, flat or dying. |
| **Release asset downloads** | cli v2.105.0: 22 assets, **98,535 downloads** | ⭐ Real adoption numbers, not stars. |
| **SBOM** (`/dependency-graph/sbom`) | **11,586 packages** | ⭐ Their complete code dependency tree — the code-level twin of the DNS TXT vendor signal. |
| **Languages** | JS 46%, TS 34%, **Rust 16%** | Tech-stack shift over time (Rust appearing is a story). |
| **Org public members** | 72 | Engineering headcount proxy. |
| **Org public events** | Push 7, PR 5, Release 1, Fork 4 (per 30) | Live activity feed, typed. |
| **Closed issues** (search API) | 24,621 | With date filters → issue-closing velocity. |
| **Top contributor** | `ijjk`, 3,296 commits | Key-person concentration risk. |
| **`package.json` / CODEOWNERS** | 195 devDeps; CODEOWNERS present | Declared deps; team structure. |
| Stars **with timestamps** | **401 — needs a token** | Star growth curve; works once the GitHub token exists. |
| `stats/code_frequency` | `202` computing | GitHub computes async; retry on a later window. |

Unauthenticated budget is **60/hr** — the free token lifts it to 5,000/hr, which
is why the token is on the account list.

## New free aggregators — all verified, no key required

| Source | Observed | Value |
|---|---|---|
| ⭐ **ecosyste.ms** | `next`: **362,061,988 downloads, 8,463 dependent packages, 345,645 dependent repos** | Adoption *depth*, not vanity. Also mirrors repo stats without GitHub's rate limit. |
| ⭐ **OpenSSF Scorecard** | `vercel/next.js` = **6.2/10 over 14 checks** | A comparable **security-posture score** per competitor. Free, no key. |
| ⭐ **deps.dev** (Google) | 4,039 versions; `licenses=[MIT]`; **37 advisories** | Per-version licence + vulnerability counts. |
| **Libraries.io** | rank 31, **142,364 dependents** | Cross-registry popularity. |
| ⭐ **Statuspage `incidents.json`** | **50 incidents, latest dated** | ⭐ **Reliability history.** "They had 12 incidents last quarter" is a sales weapon, and it is free. |
| ⭐ **Hugging Face** | `whisper-large-v3`: 3,314,125 downloads, 6,828 likes | Essential for AI competitors. |
| **Terraform Registry** | `hashicorp/aws`: **8,574,902,372 downloads** | Infra-ecosystem adoption. |
| **Open VSX** | `ms-python`: 62,886,650 downloads | VS Code ecosystem (non-Microsoft registry). |
| **PeeringDB** | Cloudflare = **ASN 13335** | Network + datacenter presence → geography. |
| **GLEIF LEI** | 58 entities for "Stripe" | Legal-entity hierarchy. Earlier failure was my filter syntax, not the API. |
| **Wikipedia revisions** | 5 recent edits | How contested/active their page is. |
| **Apple Podcasts search** | works, no key | Podcast presence. |
| **F-Droid / ArtifactHub** | both respond | Niche ecosystem adoption. |

### Not usable as-is

- **OpenAlex** — `429`. It wants a contact email for its polite pool. We will
  **not** send the user's personal address to a third party, so this needs a
  dedicated support address first. Blocked on the support-email open item.
- **Atlassian Marketplace** — endpoint responded but my addon key was wrong.
  Needs a real key to confirm.

## Running total

**~70 sources probed, ~60 usable**, across 14 modules. The research is done; what
remains is adapter config against the proven contract in `lib/sources/registry.ts`.
