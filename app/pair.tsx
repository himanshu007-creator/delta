"use client";

/**
 * Compare any two domains.
 *
 * The listed pairs are the ~690 prerendered ones, which is a catalogue, not a
 * limit — /compare/[pair] reads both companies live, so any two public domains
 * work. Without this box that was unreachable: you could only compare what was
 * already listed, which made a working feature look like a fixed menu.
 *
 * `publicDomain` and `pairKey` are the same functions the proxy and the page
 * use, so the button can only ever build a URL the server would accept, and
 * the canonical (alphabetical) order is settled here rather than by a redirect.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publicDomain } from "@/lib/domain";
import { pairKey } from "@/lib/seed";

export function PairPicker() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const router = useRouter();

  const da = publicDomain(a);
  const db = publicDomain(b);
  const slug = da && db ? pairKey(da, db) : null;
  // Only tell them WHY it is disabled once they have typed enough that the
  // reason is informative, rather than scolding an empty form.
  const problem =
    !a.trim() || !b.trim()
      ? null
      : !da || !db
        ? "Both need to be plain public domains, like linear.app"
        : da === db
          ? "Those are the same domain"
          : null;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (slug) router.push(`/compare/${slug}`);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem]">
          <span className="t-micro muted mono block mb-1.5">First domain</span>
          <input
            type="text"
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="linear.app"
            autoComplete="off"
            spellCheck={false}
            aria-label="First domain to compare"
          />
        </label>
        <span className="t-small muted mb-2.5 mono">vs</span>
        <label className="flex-1 min-w-[12rem]">
          <span className="t-micro muted mono block mb-1.5">Second domain</span>
          <input
            type="text"
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="notion.so"
            autoComplete="off"
            spellCheck={false}
            aria-label="Second domain to compare"
          />
        </label>
        <button type="submit" className="btn btn-primary mb-0.5" disabled={!slug}>
          Compare →
        </button>
      </div>
      <p className="t-small muted mt-3" aria-live="polite">
        {problem ?? "Neither has to be listed below — both sides are read live from public sources."}
      </p>
    </form>
  );
}
