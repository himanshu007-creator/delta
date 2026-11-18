"use client";

/**
 * Build-your-own plan.
 *
 * The honest bit is that this will talk you OUT of a custom plan. If a standard
 * tier covers what you moved the sliders to, it says so and shows that tier's
 * price — quoting someone for something Pro already covers is a worse outcome
 * than the smaller sale, because they find out later and then the pricing page
 * was the thing that misled them.
 *
 * A quote only appears when no standard tier fits, and it is priced as an
 * extension of the top tier so it can never undercut the published list.
 */

import { useMemo, useState } from "react";
import { CUSTOM, FREE_CALLS_PER_DAY, TOP_TIER, bestPlan, normalisePlan } from "@/lib/offer";

/** Slider stops, so the ranges are usable rather than linear-and-useless. */
const COMPANY_STOPS = [3, 10, 25, 50, 100, 200, 400, 700, 1_000, 1_500, 2_500, 5_000];
const CALL_STOPS = [25, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000];
const SEAT_STOPS = [1, 2, 3, 5, 10, 15, 25, 50];

const fmt = (n: number) => n.toLocaleString("en-GB");

function Slider({
  label, stops, index, onChange, render,
}: {
  label: string;
  stops: readonly number[];
  index: number;
  onChange: (i: number) => void;
  render: (v: number) => string;
}) {
  const id = `plan-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="t-small muted">{label}</label>
        <output htmlFor={id} className="mono t-small" style={{ color: "var(--ink)" }}>
          {render(stops[index])}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="plan-range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        // The slider moves over STOPS, not raw values: a linear 1–5,000 range
        // spends 90% of its travel in territory almost nobody wants.
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function PlanBuilder({ supportEmail }: { supportEmail?: string }) {
  const [ci, setCi] = useState(4); // 100 companies
  const [li, setLi] = useState(5); // 2,000 calls
  const [si, setSi] = useState(2); // 3 seats

  const req = useMemo(
    () => normalisePlan({ companies: COMPANY_STOPS[ci], calls: CALL_STOPS[li], seats: SEAT_STOPS[si] }),
    [ci, li, si],
  );
  const plan = useMemo(() => bestPlan(req), [req]);

  const spec = `${fmt(req.companies)} companies · ${fmt(req.calls)} API+MCP calls/day · ${req.seats} seat${req.seats === 1 ? "" : "s"}`;

  return (
    <div className="card p-6 sm:grid sm:grid-cols-5 sm:gap-8">
      <div className="sm:col-span-3">
        <p className="eyebrow mb-4">Build a plan</p>
        <div className="space-y-5">
          <Slider label="Companies tracked" stops={COMPANY_STOPS} index={ci} onChange={setCi} render={fmt} />
          <Slider
            label="API + MCP calls per day"
            stops={CALL_STOPS}
            index={li}
            onChange={setLi}
            render={fmt}
          />
          <Slider label="Seats" stops={SEAT_STOPS} index={si} onChange={setSi} render={(v) => String(v)} />
        </div>
      </div>

      <div className="sm:col-span-2 mt-6 sm:mt-0 sm:border-l sm:pl-8" style={{ borderColor: "var(--border)" }}>
        {plan.kind === "tier" ? (
          <>
            <p className="eyebrow mb-1">{plan.tier.name} covers this</p>
            <p className="t-display m-0" style={{ fontSize: "2.4rem" }}>
              {plan.monthly === 0 ? "Free" : `$${plan.monthly}`}
              {plan.monthly ? <span className="t-small muted"> /mo</span> : null}
            </p>
            <p className="t-small muted mt-3 mb-0">
              {plan.monthly === 0
                ? `The free tier already does this — ${FREE_CALLS_PER_DAY} calls a day, no card.`
                : `No custom plan needed. ${plan.tier.name} includes ${fmt(plan.tier.companies)} companies and ${fmt(plan.tier.calls)} calls a day.`}
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow mb-1">Custom</p>
            <p className="t-display m-0" style={{ fontSize: "2.4rem" }}>
              ${fmt(plan.monthly)}<span className="t-small muted"> /mo</span>
            </p>
            <p className="t-small muted mt-3 mb-0">
              Beyond {TOP_TIER.name}, priced on what you add: ${CUSTOM.perCompany.toFixed(3)} per extra
              company, ${CUSTOM.perCall.toFixed(3)} per extra daily call, ${CUSTOM.perSeat} per extra seat.
              An estimate we will honour.
            </p>
          </>
        )}

        <p className="t-micro muted mt-4 mb-0">{spec}</p>

        {plan.kind === "custom" &&
          (supportEmail ? (
            <a
              className="btn btn-primary no-underline mt-4"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent("Custom plan")}&body=${encodeURIComponent(
                `I'd like a custom plan:\n\n${spec}\n\nEstimated at $${plan.monthly}/mo.`,
              )}`}
            >
              Request this plan
            </a>
          ) : (
            // No support address configured yet, so there is nothing honest to
            // point the button at. Show the spec to copy instead of a dead link.
            <p className="t-micro muted mt-4 mb-0">
              Copy the line above and send it over — we will confirm the price.
            </p>
          ))}
      </div>
    </div>
  );
}
