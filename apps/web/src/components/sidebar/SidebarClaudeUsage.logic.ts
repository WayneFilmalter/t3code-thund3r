import type { ServerProviderUsageWindow } from "@t3tools/contracts";

const DAY_MINS = 24 * 60;

/** Fill colour for a window's bar: red above 89% used, dark yellow above 70%, green below. */
export function usageTone(usedPercent: number): string {
  if (usedPercent > 89) return "bg-destructive";
  if (usedPercent > 70) return "bg-warning";
  return "bg-success";
}

/** `Weekly · Fable` over a week reads `Weekly Fable (7 day)`. */
export function usageWindowTitle(window: ServerProviderUsageWindow): string {
  const label = window.label.replace(/\s*·\s*/g, " ");
  const mins = window.windowDurationMins;
  if (!mins) return label;
  const span =
    mins % DAY_MINS === 0
      ? `${mins / DAY_MINS} day`
      : mins % 60 === 0
        ? `${mins / 60} hour`
        : `${mins} min`;
  return `${label} (${span})`;
}
