/**
 * The seed company set and pair logic. ZERO dependencies, on purpose.
 *
 * `proxy.ts` imports this to validate /compare/[pair] at the edge, and the
 * proxy runs before route handlers — so it must not transitively pull in
 * `node:dns` through the adapter registry. Same reasoning as lib/domain.ts.
 */

export type Category =
  | "dev-infra" | "productivity" | "sales-marketing" | "fintech"
  | "hr-ops" | "security" | "ai" | "retail" | "industry";

/**
 * Seed set, CATEGORISED.
 *
 * The categories are not decoration: /compare/[a]-vs-[b] generates pairs
 * WITHIN a category only. Across 108 companies there are 5,778 possible pairs
 * and almost all are nonsense ("gymshark vs hashicorp"). Within-category pairs
 * are both a bounded set and the only ones a human would ever search for.
 */
export const SEED: ReadonlyArray<{ domain: string; name: string; category: Category }> = [
  { domain: "vercel.com", name: "Vercel", category: "dev-infra" },
  { domain: "netlify.com", name: "Netlify", category: "dev-infra" },
  { domain: "render.com", name: "Render", category: "dev-infra" },
  { domain: "fly.io", name: "Fly.io", category: "dev-infra" },
  { domain: "railway.app", name: "Railway", category: "dev-infra" },
  { domain: "cloudflare.com", name: "Cloudflare", category: "dev-infra" },
  { domain: "supabase.com", name: "Supabase", category: "dev-infra" },
  { domain: "planetscale.com", name: "PlanetScale", category: "dev-infra" },
  { domain: "mongodb.com", name: "MongoDB", category: "dev-infra" },
  { domain: "redis.io", name: "Redis", category: "dev-infra" },
  { domain: "elastic.co", name: "Elastic", category: "dev-infra" },
  { domain: "hashicorp.com", name: "HashiCorp", category: "dev-infra" },
  { domain: "docker.com", name: "Docker", category: "dev-infra" },
  { domain: "sentry.io", name: "Sentry", category: "dev-infra" },
  { domain: "datadoghq.com", name: "Datadog", category: "dev-infra" },
  { domain: "gitlab.com", name: "GitLab", category: "dev-infra" },
  { domain: "circleci.com", name: "CircleCI", category: "dev-infra" },
  { domain: "clerk.com", name: "Clerk", category: "dev-infra" },
  { domain: "resend.com", name: "Resend", category: "dev-infra" },

  { domain: "notion.so", name: "Notion", category: "productivity" },
  { domain: "linear.app", name: "Linear", category: "productivity" },
  { domain: "asana.com", name: "Asana", category: "productivity" },
  { domain: "monday.com", name: "monday.com", category: "productivity" },
  { domain: "clickup.com", name: "ClickUp", category: "productivity" },
  { domain: "airtable.com", name: "Airtable", category: "productivity" },
  { domain: "basecamp.com", name: "Basecamp", category: "productivity" },
  { domain: "slack.com", name: "Slack", category: "productivity" },
  { domain: "figma.com", name: "Figma", category: "productivity" },
  { domain: "miro.com", name: "Miro", category: "productivity" },
  { domain: "loom.com", name: "Loom", category: "productivity" },
  { domain: "zapier.com", name: "Zapier", category: "productivity" },
  { domain: "calendly.com", name: "Calendly", category: "productivity" },
  { domain: "dropbox.com", name: "Dropbox", category: "productivity" },
  { domain: "box.com", name: "Box", category: "productivity" },
  { domain: "atlassian.com", name: "Atlassian", category: "productivity" },

  { domain: "hubspot.com", name: "HubSpot", category: "sales-marketing" },
  { domain: "intercom.com", name: "Intercom", category: "sales-marketing" },
  { domain: "drift.com", name: "Drift", category: "sales-marketing" },
  { domain: "mailchimp.com", name: "Mailchimp", category: "sales-marketing" },
  { domain: "klaviyo.com", name: "Klaviyo", category: "sales-marketing" },
  { domain: "braze.com", name: "Braze", category: "sales-marketing" },
  { domain: "segment.com", name: "Segment", category: "sales-marketing" },
  { domain: "amplitude.com", name: "Amplitude", category: "sales-marketing" },
  { domain: "mixpanel.com", name: "Mixpanel", category: "sales-marketing" },
  { domain: "ahrefs.com", name: "Ahrefs", category: "sales-marketing" },
  { domain: "semrush.com", name: "Semrush", category: "sales-marketing" },
  { domain: "outreach.io", name: "Outreach", category: "sales-marketing" },
  { domain: "gong.io", name: "Gong", category: "sales-marketing" },
  { domain: "apollo.io", name: "Apollo", category: "sales-marketing" },
  { domain: "lusha.com", name: "Lusha", category: "sales-marketing" },

  { domain: "stripe.com", name: "Stripe", category: "fintech" },
  { domain: "adyen.com", name: "Adyen", category: "fintech" },
  { domain: "checkout.com", name: "Checkout.com", category: "fintech" },
  { domain: "mollie.com", name: "Mollie", category: "fintech" },
  { domain: "gocardless.com", name: "GoCardless", category: "fintech" },
  { domain: "plaid.com", name: "Plaid", category: "fintech" },
  { domain: "klarna.com", name: "Klarna", category: "fintech" },
  { domain: "monzo.com", name: "Monzo", category: "fintech" },
  { domain: "starlingbank.com", name: "Starling Bank", category: "fintech" },
  { domain: "revolut.com", name: "Revolut", category: "fintech" },
  { domain: "wise.com", name: "Wise", category: "fintech" },
  { domain: "brex.com", name: "Brex", category: "fintech" },
  { domain: "ramp.com", name: "Ramp", category: "fintech" },
  { domain: "carta.com", name: "Carta", category: "fintech" },

  { domain: "rippling.com", name: "Rippling", category: "hr-ops" },
  { domain: "gusto.com", name: "Gusto", category: "hr-ops" },
  { domain: "deel.com", name: "Deel", category: "hr-ops" },
  { domain: "remote.com", name: "Remote", category: "hr-ops" },
  { domain: "personio.com", name: "Personio", category: "hr-ops" },
  { domain: "greenhouse.io", name: "Greenhouse", category: "hr-ops" },
  { domain: "lever.co", name: "Lever", category: "hr-ops" },
  { domain: "ashbyhq.com", name: "Ashby", category: "hr-ops" },
  { domain: "workable.com", name: "Workable", category: "hr-ops" },
  { domain: "docusign.com", name: "DocuSign", category: "hr-ops" },

  { domain: "wiz.io", name: "Wiz", category: "security" },
  { domain: "snyk.io", name: "Snyk", category: "security" },
  { domain: "1password.com", name: "1Password", category: "security" },
  { domain: "okta.com", name: "Okta", category: "security" },
  { domain: "duo.com", name: "Duo", category: "security" },
  { domain: "hackerone.com", name: "HackerOne", category: "security" },
  { domain: "crowdstrike.com", name: "CrowdStrike", category: "security" },
  { domain: "proofpoint.com", name: "Proofpoint", category: "security" },
  { domain: "mimecast.com", name: "Mimecast", category: "security" },

  { domain: "anthropic.com", name: "Anthropic", category: "ai" },
  { domain: "openai.com", name: "OpenAI", category: "ai" },
  { domain: "cursor.com", name: "Cursor", category: "ai" },
  { domain: "huggingface.co", name: "Hugging Face", category: "ai" },
  { domain: "perplexity.ai", name: "Perplexity", category: "ai" },
  { domain: "elevenlabs.io", name: "ElevenLabs", category: "ai" },
  { domain: "replicate.com", name: "Replicate", category: "ai" },
  { domain: "cohere.com", name: "Cohere", category: "ai" },

  { domain: "gymshark.com", name: "Gymshark", category: "retail" },
  { domain: "patagonia.com", name: "Patagonia", category: "retail" },
  { domain: "allbirds.com", name: "Allbirds", category: "retail" },
  { domain: "glossier.com", name: "Glossier", category: "retail" },
  { domain: "warbyparker.com", name: "Warby Parker", category: "retail" },
  { domain: "bellroy.com", name: "Bellroy", category: "retail" },
  { domain: "brompton.com", name: "Brompton", category: "retail" },
  { domain: "oatly.com", name: "Oatly", category: "retail" },
  { domain: "huel.com", name: "Huel", category: "retail" },
  { domain: "castore.com", name: "Castore", category: "retail" },
  { domain: "represent.com", name: "Represent", category: "retail" },
  { domain: "away.com", name: "Away", category: "retail" },

  { domain: "siemens.com", name: "Siemens", category: "industry" },
  { domain: "dyson.com", name: "Dyson", category: "industry" },
  { domain: "rolls-royce.com", name: "Rolls-Royce", category: "industry" },
  { domain: "arup.com", name: "Arup", category: "industry" },
  { domain: "ocado.com", name: "Ocado", category: "industry" },
  { domain: "gpe.co.uk", name: "Great Portland Estates", category: "industry" },
  { domain: "britishland.com", name: "British Land", category: "industry" },
  { domain: "landsec.com", name: "Landsec", category: "industry" },
];

export const SEED_DOMAINS: readonly string[] = SEED.map((s) => s.domain);

export const seedFor = (domain: string) => SEED.find((s) => s.domain === domain) ?? null;

/** Canonical pair key: alphabetical, so a-vs-b and b-vs-a are one page. */
export function pairKey(a: string, b: string): string | null {
  if (!a || !b || a === b) return null;
  const [x, y] = [a, b].sort();
  return `${x}-vs-${y}`;
}

/** Parse a pair slug back into two domains, if both are in the seed set. */
export function parsePair(slug: string): { a: string; b: string } | null {
  const parts = slug.split("-vs-");
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim().toLowerCase());
  if (!a || !b || a === b) return null;
  if (!seedFor(a) || !seedFor(b)) return null;
  return { a, b };
}

/**
 * Every sensible comparison: within-category pairs only.
 * ~600 pages rather than 5,778, and every one is a query a human would type.
 */
export function comparablePairs(): { slug: string; a: string; b: string; category: Category }[] {
  const out: { slug: string; a: string; b: string; category: Category }[] = [];
  const byCat = new Map<Category, string[]>();
  for (const s of SEED) {
    byCat.set(s.category, [...(byCat.get(s.category) ?? []), s.domain]);
  }
  for (const [category, domains] of byCat) {
    const sorted = [...domains].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const slug = pairKey(sorted[i], sorted[j]);
        if (slug) out.push({ slug, a: sorted[i], b: sorted[j], category });
      }
    }
  }
  return out;
}


