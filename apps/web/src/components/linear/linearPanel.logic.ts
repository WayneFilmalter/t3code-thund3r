import type { LinearIssue, LinearIssuePriority } from "@t3tools/contracts";

export const PRIORITY_LABELS: Record<LinearIssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

/** Linear estimates are points on the team's scale; one point reads as singular. */
export function estimateLabel(estimate: number | null): string | null {
  if (estimate === null) return null;
  return estimate === 1 ? "1 pt" : `${estimate} pts`;
}

export type LinearSectionState = "idle" | "loading" | "error" | "empty" | "ready";

/**
 * What a section shows under its header. A refresh with results already in
 * hand keeps the list visible, so loading and error only win before the
 * first result lands.
 */
export function sectionState(view: {
  readonly armed: boolean;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly issues: ReadonlyArray<LinearIssue> | null;
}): LinearSectionState {
  if (!view.armed) return "idle";
  if (view.issues === null) {
    if (view.isPending) return "loading";
    if (view.error !== null) return "error";
    return "loading";
  }
  return view.issues.length === 0 ? "empty" : "ready";
}
