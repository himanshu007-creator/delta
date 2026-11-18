/**
 * JSON-LD emitter.
 *
 * We read schema.org markup off other companies' pages — publishing our own is
 * both the same courtesy and the thing that makes these pages legible to search
 * engines and assistants rather than just to humans.
 *
 * `JSON.stringify` output is escaped for a script context: a `<` inside any
 * string would otherwise let page data close the tag early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // The value is ours and escaped above; no user input reaches it unescaped.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
