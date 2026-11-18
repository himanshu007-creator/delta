/**
 * "Ask an assistant about this page."
 *
 * Two reasons this exists, and the second is the real one.
 *
 * For a reader, it is a shortcut: hand the page to Claude or ChatGPT and ask a
 * follow-up instead of reading a table.
 *
 * For us, it is distribution. Ad spend is subtracted from profit, so paid
 * acquisition is off the table — and these buttons send an assistant to fetch
 * our page, with our framing, on a visitor's behalf. A page that asks to be
 * read by a model is a page that gets cited by one.
 *
 * ponytail: plain anchors. No client component, no JS, no analytics wrapper —
 * a deep link with a query string is the entire mechanism.
 */

import { SITE_NAME, abs } from "@/lib/site";

/**
 * Where each assistant accepts a prefilled prompt.
 *
 * All three take the prompt in `q` and submit it on load. If one changes its
 * parameter the button degrades to opening a blank chat, which is why the
 * prompt also names the URL — the user can still paste it.
 */
const ASSISTANTS = [
  { name: "Claude", base: "https://claude.ai/new?q=" },
  { name: "ChatGPT", base: "https://chatgpt.com/?q=" },
  { name: "Perplexity", base: "https://www.perplexity.ai/search?q=" },
] as const;

export function AskAbout({
  /** Absolute or root-relative path of the page being asked about. */
  path,
  /** The question, without the URL — that is appended here. */
  ask,
  className = "",
}: {
  path: string;
  ask: string;
  className?: string;
}) {
  const url = path.startsWith("http") ? path : abs(path);

  // The URL goes FIRST. Assistants that fetch a link do it more reliably when
  // the link opens the prompt, and a truncated prompt still contains it.
  const prompt = `${url}\n\n${ask} Cite the source links shown on the page, and say so if something is missing rather than filling it in.`;

  return (
    <aside className={`card-quiet p-5 ${className}`}>
      <p className="eyebrow mb-2">Ask an assistant</p>
      <p className="t-small muted mt-0 mb-4" style={{ maxWidth: "52ch" }}>
        {ask} Opens with the question filled in.
      </p>

      <div className="flex flex-wrap gap-2">
        {ASSISTANTS.map((a) => (
          <a
            key={a.name}
            className="btn btn-sm no-underline"
            href={a.base + encodeURIComponent(prompt)}
            // noopener for the usual reason; nofollow because these are
            // utility links to third parties, not endorsements we vouch for.
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {a.name} →
          </a>
        ))}
      </div>

      <p className="t-micro muted mt-4 mb-0">
        {SITE_NAME} publishes <a href="/llms.txt">llms.txt</a> and schema.org data on every page,
        so an assistant reads the same facts you do — with the same sources attached.
      </p>
    </aside>
  );
}
