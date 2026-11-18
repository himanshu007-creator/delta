/**
 * Never hit a rate limit.
 *
 * Providers differ wildly: Groq's free tier is ~8K tokens PER MINUTE, which at
 * ~3k tokens a row is two rows a minute. A fixed concurrency number is wrong
 * for every provider at once, so instead we steer off what the provider tells
 * us and adapt.
 *
 * Three mechanisms, in order of authority:
 *  1. Response headers (x-ratelimit-remaining-*) — the provider's own truth.
 *  2. A local token+request budget per rolling minute, so we throttle BEFORE
 *     sending rather than after being refused.
 *  3. AIMD concurrency: creep up while things succeed, halve on a 429.
 */

export type LimiterStatus = {
  concurrency: number;
  inFlight: number;
  tokensUsedThisMinute: number;
  requestsThisMinute: number;
  pausedForMs: number;
  tpm?: number;
  rpm?: number;
};

export type LimitSnapshot = {
  /** Requests we believe remain in the current window. */
  remainingRequests?: number;
  /** Tokens we believe remain in the current window. */
  remainingTokens?: number;
  /** Seconds until the token window resets. */
  resetTokensSec?: number;
  /** Seconds the provider told us to wait (429 only). */
  retryAfterSec?: number;
};

/** Parses Groq/OpenAI style durations: "2m59.56s", "7.66s", "150ms". */
export function parseDuration(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let total = 0;
  let matched = false;
  for (const [, num, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g)) {
    matched = true;
    const n = Number(num);
    total += unit === "ms" ? n / 1000 : unit === "s" ? n : unit === "m" ? n * 60 : n * 3600;
  }
  return matched ? total : undefined;
}

export function readLimitHeaders(h: Headers): LimitSnapshot {
  const int = (k: string) => {
    const v = h.get(k);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    remainingRequests: int("x-ratelimit-remaining-requests"),
    remainingTokens: int("x-ratelimit-remaining-tokens"),
    resetTokensSec: parseDuration(h.get("x-ratelimit-reset-tokens")),
    retryAfterSec: parseDuration(h.get("retry-after")),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LimiterOptions = {
  /** Requests per minute ceiling. Undefined = unknown, discovered by probing. */
  rpm?: number;
  /** Tokens per minute ceiling. The binding constraint on free tiers. */
  tpm?: number;
  maxConcurrency?: number;
};

export class RateLimiter {
  private inFlight = 0;
  private concurrency: number;
  private readonly maxConcurrency: number;
  private rpm?: number;
  private tpm?: number;
  /** [timestampMs, tokens] for the rolling window. */
  private spent: Array<[number, number]> = [];
  /** Wall-clock time before which nothing may be sent. */
  private pausedUntil = 0;
  private consecutiveOk = 0;

  constructor(opts: LimiterOptions = {}) {
    this.rpm = opts.rpm;
    this.tpm = opts.tpm;
    this.maxConcurrency = opts.maxConcurrency ?? 8;
    // Start cautious. Earning throughput beats being refused.
    this.concurrency = Math.min(2, this.maxConcurrency);
  }

  setCeilings(opts: { rpm?: number; tpm?: number }) {
    if (opts.rpm !== undefined) this.rpm = opts.rpm;
    if (opts.tpm !== undefined) this.tpm = opts.tpm;
  }

  private prune(now: number) {
    const cutoff = now - 60_000;
    while (this.spent.length && this.spent[0][0] < cutoff) this.spent.shift();
  }

  private usedTokens(now: number) {
    this.prune(now);
    return this.spent.reduce((a, [, t]) => a + t, 0);
  }

  private usedRequests(now: number) {
    this.prune(now);
    return this.spent.length;
  }

  /**
   * Wait until it is safe to send a request expected to cost ~estTokens.
   * Returns a release() that must be called when the request settles.
   *
   * Throws AbortError if the signal fires, so Stop is immediate instead of
   * waiting for the current sleep to elapse.
   */
  async acquire(estTokens: number, signal?: AbortSignal): Promise<(actualTokens?: number) => void> {
    const budget = this.tpm ? this.tpm * 0.85 : Infinity;
    // A single request larger than the whole window can NEVER satisfy
    // `used + est <= budget`, so an unclamped estimate spins forever even with
    // an empty window. Clamp it: wait for the window to clear, then send and
    // let the provider's own 429 (and penalise()) be the authority.
    const need = Math.min(estTokens, budget);

    for (;;) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const now = Date.now();

      if (now < this.pausedUntil) {
        await this.wait(Math.min(this.pausedUntil - now, 2_000), signal);
        continue;
      }
      if (this.inFlight >= this.concurrency) {
        await this.wait(60, signal);
        continue;
      }
      if (this.tpm && this.usedTokens(now) + need > budget) {
        const oldest = this.spent[0]?.[0] ?? now;
        await this.wait(Math.max(250, Math.min(60_000 - (now - oldest), 2_000)), signal);
        continue;
      }
      if (this.rpm && this.usedRequests(now) + 1 > this.rpm * 0.85) {
        const oldest = this.spent[0]?.[0] ?? now;
        await this.wait(Math.max(250, Math.min(60_000 - (now - oldest), 2_000)), signal);
        continue;
      }

      this.inFlight++;
      // Book the estimate now; correct it with real usage in release().
      const entry: [number, number] = [now, estTokens];
      this.spent.push(entry);

      let released = false;
      return (actualTokens?: number) => {
        if (released) return;
        released = true;
        this.inFlight--;
        if (typeof actualTokens === "number" && Number.isFinite(actualTokens)) {
          entry[1] = actualTokens;
        }
      };
    }
  }

  /** Sleep that wakes early on abort, so Stop never waits out a backoff. */
  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        signal?.removeEventListener("abort", done);
        resolve();
      }
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  /** Feed the provider's own numbers back in. They outrank our guesses. */
  report(snap: LimitSnapshot) {
    if (snap.remainingTokens !== undefined && snap.resetTokensSec !== undefined) {
      // Almost out and the window hasn't rolled? Wait it out rather than probe.
      if (snap.remainingTokens <= 0) {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + snap.resetTokensSec * 1000);
      }
    }
    if (snap.remainingRequests !== undefined && snap.remainingRequests <= 0) {
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + 2_000);
    }
    this.consecutiveOk++;
    // Additive increase — earn one more slot after a clean streak.
    if (this.consecutiveOk >= 8 && this.concurrency < this.maxConcurrency) {
      this.concurrency++;
      this.consecutiveOk = 0;
    }
  }

  /** A 429 happened. Back off hard; we were wrong. */
  penalise(retryAfterSec?: number) {
    this.consecutiveOk = 0;
    this.concurrency = Math.max(1, Math.floor(this.concurrency / 2));
    const wait = (retryAfterSec ?? 5) * 1000;
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + wait);
  }

  /**
   * A 5xx or a network failure. Not our fault, but hammering a struggling
   * endpoint at full parallelism makes it worse and wastes the user's money.
   */
  easeOff() {
    this.consecutiveOk = 0;
    this.concurrency = Math.max(1, this.concurrency - 1);
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + 1_000);
  }

  get status(): LimiterStatus {
    const now = Date.now();
    return {
      concurrency: this.concurrency,
      inFlight: this.inFlight,
      tokensUsedThisMinute: this.usedTokens(now),
      requestsThisMinute: this.usedRequests(now),
      pausedForMs: Math.max(0, this.pausedUntil - now),
      tpm: this.tpm,
      rpm: this.rpm,
    };
  }
}

/**
 * Published free-tier ceilings, used as the opening assumption before the
 * first response teaches us the real numbers. Conservative on purpose.
 */
export const FREE_TIER_CEILINGS: Record<string, { rpm?: number; tpm?: number }> = {
  // Groq free tier is tokens-per-minute bound, and brutally so.
  groq: { rpm: 25, tpm: 7_000 },
  // Gemini free tier limits are per-project and undocumented; stay modest.
  google: { rpm: 10, tpm: 200_000 },
  // Anthropic depends on spend tier; start low and let AIMD find the ceiling.
  anthropic: { rpm: 20 },
};
