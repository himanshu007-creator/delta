"use client";

/**
 * The live origin, for copy-paste snippets.
 *
 * A statically prerendered page bakes whatever origin the BUILD knew about,
 * so a fork on its own domain would hand visitors this project's URL to paste
 * into their MCP client. That is the one place a wrong host is actively
 * user-hostile rather than merely untidy.
 *
 * The swap happens in an effect rather than during render, so the first paint
 * matches the server exactly and there is no hydration mismatch — the
 * build-time value is correct for SSR, for crawlers and for anyone without
 * JavaScript, and the live one replaces it a tick later.
 */

import { useEffect, useState } from "react";

export function LiveOrigin({ fallback }: { fallback: string }) {
  const [origin, setOrigin] = useState(fallback);
  useEffect(() => setOrigin(window.location.origin), []);
  return <>{origin}</>;
}

/**
 * A code block whose `{ORIGIN}` placeholders become the live origin.
 *
 * Takes the template as a string rather than children so the substitution is
 * a single pass over text, with no walking of React nodes.
 */
export function LiveCode({ template, fallback }: { template: string; fallback: string }) {
  const [origin, setOrigin] = useState(fallback);
  useEffect(() => setOrigin(window.location.origin), []);
  return <>{template.replaceAll("{ORIGIN}", origin)}</>;
}

/**
 * Assistant deep links, built from the page the reader is actually on.
 *
 * These links hand a URL to Claude or ChatGPT and ask it to go and read it.
 * Built at build time they would send every fork's visitors to the original
 * deployment — the one case where a stale origin does not just look wrong, it
 * sends traffic and citations to someone else's site.
 *
 * Rendered server-side with the canonical URL first (correct for crawlers and
 * for no-JS), then corrected to the live address on mount.
 */
export function AssistantLinks({
  assistants,
  path,
  ask,
  fallbackOrigin,
}: {
  assistants: ReadonlyArray<{ name: string; base: string }>;
  path: string;
  ask: string;
  fallbackOrigin: string;
}) {
  const [origin, setOrigin] = useState(fallbackOrigin);
  useEffect(() => setOrigin(window.location.origin), []);

  // The URL goes FIRST: assistants that fetch a link do it more reliably when
  // the link opens the prompt, and a truncated prompt still contains it.
  const prompt =
    `${origin}${path}\n\n${ask} Cite the source links shown on the page, and say so if ` +
    `something is missing rather than filling it in.`;

  return (
    <div className="flex flex-wrap gap-2">
      {assistants.map((a) => (
        <a
          key={a.name}
          className="btn btn-sm no-underline"
          href={a.base + encodeURIComponent(prompt)}
          // noopener for the usual reason; nofollow because these are utility
          // links to third parties, not endorsements we vouch for.
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {a.name} →
        </a>
      ))}
    </div>
  );
}
