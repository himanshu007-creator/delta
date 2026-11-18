/**
 * Provider adapters — BROWSER SIDE, BY DESIGN.
 *
 * Calls are made from the user's own browser with the user's own key. The key
 * never reaches our servers, is never logged, and lives only in localStorage.
 * That is why this file is in the client bundle instead of an API route.
 *
 * Every adapter returns the provider's OWN reported token usage plus whatever
 * rate-limit headers it exposes. We never estimate tokens.
 */

import type { ProviderId, Usage } from "./pricing";
import { readLimitHeaders, type LimitSnapshot } from "./limiter";

export type CallResult = {
  text: string;
  usage: Usage;
  limits: LimitSnapshot;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate-limit" | "quota" | "bad-request" | "network" | "server" | "cors" | "aborted",
    readonly status?: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function classify(status: number, body: string, limits: LimitSnapshot): ProviderError {
  // Never echo the body on auth errors — some providers reflect part of the key.
  if (status === 401 || status === 403) {
    return new ProviderError(
      "That API key was rejected. Check it's correct and has access enabled.",
      "auth",
      status,
    );
  }
  if (status === 429) {
    const quota = /quota|insufficient_quota|billing|credit/i.test(body);
    return quota
      ? new ProviderError("Your provider account is out of quota or credit.", "quota", status)
      : new ProviderError("Rate limited — backing off.", "rate-limit", status, limits.retryAfterSec);
  }
  if (status >= 500) return new ProviderError("Provider is having problems. Retrying.", "server", status);
  return new ProviderError(`Provider rejected the request (${status}).`, "bad-request", status);
}

const TIMEOUT_MS = 45_000;

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      // Stop must cancel an in-flight request, not just stop issuing new ones.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      throw new ProviderError("Stopped.", "aborted");
    }
    // A browser CORS rejection surfaces as an opaque TypeError, not a status.
    if (e instanceof TypeError) {
      throw new ProviderError(
        "The browser blocked that request. This provider may not allow direct browser calls.",
        "cors",
      );
    }
    throw new ProviderError("Couldn't reach the provider. Check your connection.", "network");
  }
}

// --- Google -----------------------------------------------------------------

async function callGoogle(
  model: string,
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<CallResult> {
  const res = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        // Gemini 3.x: temperature / topP / topK are deprecated — silently
        // ignored on 3.6+ and documented to error on future generations.
        // thinkingLevel replaced thinkingBudget; "minimal" is cheapest, and
        // Flash-Lite cannot turn thinking fully off.
        thinkingConfig: { thinkingLevel: "minimal" },
        // Caps thinking PLUS output. Too low and thinking eats the budget,
        // returning MAX_TOKENS with empty text — billed, useless.
        maxOutputTokens: 1024,
      },
    },
    signal,
  );
  const limits = readLimitHeaders(res.headers);
  const raw = await res.text();
  if (!res.ok) throw classify(res.status, raw, limits);

  const json = JSON.parse(raw);
  const text: string =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const m = json?.usageMetadata ?? {};
  return {
    text,
    usage: {
      inputTokens: m.promptTokenCount ?? 0,
      // Thinking tokens bill at the output rate — counting them is the
      // difference between an honest receipt and a flattering one.
      outputTokens: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
    },
    limits,
  };
}

// --- Anthropic --------------------------------------------------------------

async function callAnthropic(
  model: string,
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<CallResult> {
  const res = await post(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required to call Anthropic from a browser. Appropriate here precisely
      // because the key belongs to the person at the keyboard.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    {
      model,
      max_tokens: 700,
      system,
      // Grounded extraction needs no reasoning; off keeps rows cheap and fast.
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: user }],
    },
    signal,
  );
  const limits = readLimitHeaders(res.headers);
  const raw = await res.text();
  if (!res.ok) throw classify(res.status, raw, limits);

  const json = JSON.parse(raw);
  const text: string =
    json?.content?.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("") ??
    "";
  const u = json?.usage ?? {};
  return {
    text,
    usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 },
    limits,
  };
}

// --- Groq (OpenAI-compatible) ----------------------------------------------

async function callGroq(
  model: string,
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<CallResult> {
  const res = await post(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      // gpt-oss models reason by default at "medium"; low cuts output tokens,
      // which on Groq's free tier is the binding constraint.
      reasoning_effort: "low",
      max_completion_tokens: 700,
    },
    signal,
  );
  const limits = readLimitHeaders(res.headers);
  const raw = await res.text();
  if (!res.ok) throw classify(res.status, raw, limits);

  const json = JSON.parse(raw);
  const u = json?.usage ?? {};
  return {
    text: json?.choices?.[0]?.message?.content ?? "",
    usage: { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 },
    limits,
  };
}

// --- Entry point ------------------------------------------------------------

export async function callModel(
  provider: ProviderId,
  model: string,
  apiKey: string,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<CallResult> {
  switch (provider) {
    case "google":
      return callGoogle(model, apiKey, system, user, signal);
    case "anthropic":
      return callAnthropic(model, apiKey, system, user, signal);
    case "groq":
      return callGroq(model, apiKey, system, user, signal);
  }
}

/**
 * Models are asked for JSON, but a stray ```json fence or a leading sentence
 * still happens. Recover what we can; a real failure returns null and the row
 * is skipped rather than guessed at.
 */
export function parseJsonLoose(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const candidates = [text, text.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/```[\s\S]*$/, "")];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next shape
    }
  }
  return null;
}
