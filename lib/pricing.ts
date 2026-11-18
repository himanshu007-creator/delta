/**
 * Model catalogue and cost accounting.
 *
 * COST HONESTY IS THE PRODUCT. Two rules govern this file:
 *
 *  1. Token counts are NEVER estimated. They come from the provider's own
 *     response payload. If a provider doesn't return usage, we report unknown
 *     rather than guess.
 *  2. Prices are config, not folklore. Every entry carries the date and the
 *     official URL it was read from, both surfaced in the UI, and the user can
 *     override them. Providers change prices; a stale constant would quietly
 *     turn our headline claim into a lie.
 */

export type ProviderId = "google" | "anthropic" | "groq";

export type ModelSpec = {
  id: string;
  provider: ProviderId;
  label: string;
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
  /** True if the provider offers a no-credit-card free tier for this model. */
  freeTier: boolean;
  notes?: string;
};

/** Where each provider's numbers came from, shown in the UI next to the cost. */
export const PRICE_SOURCES: Record<ProviderId, { url: string; verifiedOn: string }> = {
  google: { url: "https://aistudio.google.com/docs/pricing", verifiedOn: "2026-11-18" },
  anthropic: { url: "https://platform.claude.com/docs/en/about-claude/pricing", verifiedOn: "2026-11-03" },
  groq: { url: "https://console.groq.com/docs/models", verifiedOn: "2026-11-18" },
};

export const MODELS: ModelSpec[] = [
  // --- Google: free tier means a brand-new user pays nothing to try.
  // gemini-2.5-* is deliberately absent: 2.5 access is restricted to accounts
  // that already used it, so a fresh free key cannot call it at all.
  {
    id: "gemini-3.5-flash-lite",
    provider: "google",
    label: "Gemini 3.5 Flash-Lite",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    freeTier: true,
    notes: "Default. Free of charge on Google's free tier — start here, no card.",
  },
  {
    id: "gemini-3.8-flash",
    provider: "google",
    label: "Gemini 3.8 Flash",
    inputPerMTok: 0.75,
    outputPerMTok: 3.75,
    freeTier: true,
    notes: "Better judgement on messy sites. Also free-tier eligible.",
  },

  // --- Anthropic: cheapest at scale once you are past the free tier.
  {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    label: "Claude Haiku 5.5",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    freeTier: false,
    notes: "Cheapest per row, and no thinking tokens. Best for big runs.",
  },

  // --- Groq: cheapest tokens anywhere, but the free tier is tokens-per-minute
  // bound (~8K TPM), so throughput is limited even though price is not.
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B (Groq)",
    inputPerMTok: 0.075,
    outputPerMTok: 0.3,
    freeTier: true,
    notes: "Cheapest per token. Free tier is slow (~8K tokens/min) but costs nothing.",
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    label: "GPT-OSS 120B (Groq)",
    inputPerMTok: 0.15,
    outputPerMTok: 0.6,
    freeTier: true,
    notes: "Better judgement, still cheap.",
  },
];

/** Start free. Switch to CHEAPEST_MODEL_ID once the lines look good. */
export const DEFAULT_MODEL_ID = "gemini-3.5-flash-lite";
export const CHEAPEST_MODEL_ID = "openai/gpt-oss-20b";

export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

export type Usage = { inputTokens: number; outputTokens: number };

/**
 * Exact cost for one call, in USD. Not rounded — we accumulate at full
 * precision and only round for display, so a 10,000-row total doesn't drift.
 */
export function costUsd(usage: Usage, model: ModelSpec): number {
  return (
    (usage.inputTokens / 1_000_000) * model.inputPerMTok +
    (usage.outputTokens / 1_000_000) * model.outputPerMTok
  );
}

/** Display helper: sub-cent totals still need to read as real money. */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/**
 * What the incumbents charge, for the comparison on the receipt.
 *
 * These are PUBLISHED LIST PRICES, quoted as rates per contact, with the date
 * read. We compare only on published pricing and never use anyone's branding.
 * If a competitor changes price, update here — an inflated comparison would
 * discredit the one thing we sell.
 */
export const COMPETITOR_RATES = [
  { name: "Lyne.ai", perContactUsd: 0.3, verifiedOn: "2026-11-18", note: "pay-as-you-go, published rate" },
  { name: "Smartwriter", perContactUsd: 0.1475, verifiedOn: "2026-11-18", note: "$59/mo ÷ 400 lead credits" },
] as const;

/** The headline multiple on the receipt. Uses the cheapest competitor, on purpose. */
export function comparisonFor(rowsWritten: number, actualCostUsd: number) {
  const cheapest = [...COMPETITOR_RATES].sort((a, b) => a.perContactUsd - b.perContactUsd)[0];
  const theirCost = rowsWritten * cheapest.perContactUsd;
  const multiple = actualCostUsd > 0 ? theirCost / actualCostUsd : 0;
  return { competitor: cheapest.name, theirCost, multiple };
}
