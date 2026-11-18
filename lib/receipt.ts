/**
 * The Receipt.
 *
 * Not a feature — the marketing. A run produces a shareable ASCII receipt
 * showing exactly what the user paid versus the published rate of the tool
 * they'd otherwise be using. It is the launch-post screenshot, the social
 * proof and the share artifact in one object.
 *
 * Every number here comes from measured token usage. Nothing is rounded up in
 * our favour and the comparison uses the CHEAPEST competitor rate.
 */

import { comparisonFor, formatUsd, getModel, type Usage } from "./pricing";

export type ReceiptData = {
  rowsTotal: number;
  rowsWritten: number;
  rowsSkipped: number;
  modelId: string;
  usage: Usage;
  /** Total actually paid, INCLUDING the one-off site-profiling call. */
  costUsd: number;
  /** Shown as its own line so the figures add up on inspection. */
  sellerCostUsd?: number;
};

const W = 44; // inner width between the box rules

const pad = (left: string, right = "") => {
  const space = Math.max(1, W - left.length - right.length);
  return `║ ${left}${" ".repeat(space)}${right} ║`;
};

const centre = (text: string) => {
  const lead = Math.max(0, Math.floor((W - text.length) / 2));
  const trail = Math.max(0, W - text.length - lead);
  return `║ ${" ".repeat(lead)}${text}${" ".repeat(trail)} ║`;
};

const divider = () => `║ ${"─".repeat(W)} ║`;

const num = (n: number) => n.toLocaleString("en-US");

export function renderReceipt(d: ReceiptData): string {
  const model = getModel(d.modelId);
  const inCost = model ? (d.usage.inputTokens / 1_000_000) * model.inputPerMTok : 0;
  const outCost = model ? (d.usage.outputTokens / 1_000_000) * model.outputPerMTok : 0;
  const { competitor, theirCost, multiple } = comparisonFor(d.rowsWritten, d.costUsd);

  // Bar is capped so a 1000x run doesn't blow out the box.
  const barLen = Math.max(1, Math.min(22, Math.round(Math.log10(Math.max(multiple, 1)) * 7)));

  const lines = [
    `╔${"═".repeat(W + 2)}╗`,
    centre("L  E  D  E"),
    centre("─".repeat(18)),
    pad(""),
    pad(`${num(d.rowsTotal)} rows`, `${num(d.rowsWritten)} written`),
    pad("", `${num(d.rowsSkipped)} skipped`),
    pad(""),
    pad(model?.label ?? d.modelId),
    pad(`  in   ${num(d.usage.inputTokens)} tok`, formatUsd(inCost)),
    pad(`  out  ${num(d.usage.outputTokens)} tok`, formatUsd(outCost)),
    ...(d.sellerCostUsd ? [pad("  reading your site", formatUsd(d.sellerCostUsd))] : []),
    divider(),
    pad("YOU PAID", formatUsd(d.costUsd)),
    pad(`${competitor.toUpperCase()} WOULD CHARGE`, formatUsd(theirCost)),
    pad(""),
    pad(`${"░".repeat(barLen)}`, `${Math.round(multiple)}x`),
    `╚${"═".repeat(W + 2)}╝`,
  ];

  return lines.join("\n");
}

/** One-line version for a tweet or a Slack message. */
export function renderOneLiner(d: ReceiptData): string {
  const { competitor, theirCost } = comparisonFor(d.rowsWritten, d.costUsd);
  return `Personalized ${num(d.rowsWritten)} cold emails for ${formatUsd(d.costUsd)}. ${competitor} would have charged ${formatUsd(theirCost)}.`;
}
