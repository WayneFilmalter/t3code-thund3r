import type { LinearIssuePriority, LinearIssueStatus } from "@t3tools/contracts";

import type { ComponentProps } from "react";

import type { Badge } from "~/components/ui/badge";

/** The footer badge reads the priority in colour; `outline` keeps the unprioritised ones quiet. */
export const PRIORITY_BADGE_VARIANTS: Record<
  LinearIssuePriority,
  NonNullable<ComponentProps<typeof Badge>["variant"]>
> = {
  urgent: "error",
  high: "warning",
  medium: "info",
  low: "secondary",
  none: "outline",
};

/**
 * Section headers take the colour of their Linear state so the rail reads at
 * a glance; cards take their border from the issue's priority instead, so an
 * urgent ticket stands out whichever section it sits in. Same class shapes as
 * the workflow tones so the two panels match.
 */
export const STATUS_TONES: Record<LinearIssueStatus, { label: string; rule: string }> = {
  qa: {
    label: "text-purple-600 dark:text-purple-400",
    rule: "bg-purple-500/40 dark:bg-purple-400/30",
  },
  testflight: {
    label: "text-blue-600 dark:text-blue-400",
    rule: "bg-blue-500/40 dark:bg-blue-400/30",
  },
  "in-review": {
    label: "text-emerald-600 dark:text-emerald-400",
    rule: "bg-emerald-500/40 dark:bg-emerald-400/30",
  },
  "in-progress": {
    label: "text-yellow-600 dark:text-yellow-400",
    rule: "bg-yellow-500/40 dark:bg-yellow-400/30",
  },
  todo: {
    label: "text-muted-foreground",
    rule: "bg-border",
  },
  backlog: {
    label: "text-muted-foreground/60",
    rule: "bg-border/60",
  },
};

/**
 * `bubble` is the Linear tab's quiet border. `card` is the Priorities panel's
 * louder border and wash, where the priority is the point of the list, and
 * `dot` doubles as its left strip.
 */
export const PRIORITY_TONES: Record<
  LinearIssuePriority,
  { bubble: string; card: string; dot: string | null }
> = {
  urgent: {
    bubble: "border-red-500/40 dark:border-red-400/35",
    card: "border-red-500/75 bg-red-500/[0.07] dark:border-red-400/65 dark:bg-red-400/[0.08]",
    dot: "bg-red-500 dark:bg-red-400",
  },
  high: {
    bubble: "border-orange-500/40 dark:border-orange-400/35",
    card: "border-orange-500/75 bg-orange-500/[0.07] dark:border-orange-400/65 dark:bg-orange-400/[0.08]",
    dot: "bg-orange-500 dark:bg-orange-400",
  },
  medium: {
    bubble: "border-yellow-500/35 dark:border-yellow-400/30",
    card: "border-yellow-500/70 bg-yellow-500/[0.06] dark:border-yellow-400/60 dark:bg-yellow-400/[0.07]",
    dot: "bg-yellow-500 dark:bg-yellow-400",
  },
  low: {
    bubble: "border-blue-500/30 dark:border-blue-400/25",
    card: "border-blue-500/65 bg-blue-500/[0.06] dark:border-blue-400/55 dark:bg-blue-400/[0.07]",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  none: {
    bubble: "border-border/60",
    card: "border-border bg-card/60",
    dot: null,
  },
};

/**
 * Priorities panel tasks are always purple, whatever their priority, so they
 * stand apart from tickets. Same `card` / `dot` shapes as `PRIORITY_TONES`.
 */
export const TASK_TONE = {
  card: "border-purple-500/75 bg-purple-500/[0.07] dark:border-purple-400/65 dark:bg-purple-400/[0.08]",
  dot: "bg-purple-500 dark:bg-purple-400",
};
