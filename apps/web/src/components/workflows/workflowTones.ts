import type { WorkflowSectionId } from "./workflowsPanel.logic";

/**
 * Each section carries the colour of the state it holds so a glance at the rail says what is
 * running, waiting, done, or stuck. The neutral list of built workflows stays grey. Bubbles
 * take their border from the section they sit in, so the same run reads differently as it
 * moves.
 */
export const SECTION_TONES: Record<
  WorkflowSectionId,
  { label: string; rule: string; dot: string | null; bubble: string }
> = {
  workflows: {
    label: "text-muted-foreground",
    rule: "bg-border",
    dot: null,
    bubble: "border-border/60",
  },
  scheduled: {
    label: "text-orange-600 dark:text-orange-400",
    rule: "bg-orange-500/40 dark:bg-orange-400/30",
    dot: "bg-orange-500 dark:bg-orange-400",
    bubble: "border-orange-500/30 dark:border-orange-400/25",
  },
  "in-progress": {
    label: "text-yellow-600 dark:text-yellow-400",
    rule: "bg-yellow-500/40 dark:bg-yellow-400/30",
    dot: "bg-yellow-500 dark:bg-yellow-400",
    bubble: "border-yellow-500/30 dark:border-yellow-400/25",
  },
  review: {
    label: "text-blue-600 dark:text-blue-400",
    rule: "bg-blue-500/40 dark:bg-blue-400/30",
    dot: "bg-blue-500 dark:bg-blue-400",
    bubble: "border-blue-500/30 dark:border-blue-400/25",
  },
  stuck: {
    label: "text-red-600 dark:text-red-400",
    rule: "bg-red-500/40 dark:bg-red-400/30",
    dot: "bg-red-500 dark:bg-red-400",
    bubble: "border-red-500/30 dark:border-red-400/25",
  },
  done: {
    label: "text-emerald-600 dark:text-emerald-400",
    rule: "bg-emerald-500/40 dark:bg-emerald-400/30",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    bubble: "border-emerald-500/30 dark:border-emerald-400/25",
  },
};
