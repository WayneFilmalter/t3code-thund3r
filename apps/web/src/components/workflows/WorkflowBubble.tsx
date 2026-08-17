import {
  CalendarClockIcon,
  CalendarOffIcon,
  CheckIcon,
  EyeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "~/timestampFormat";
import type { WorkflowRun } from "~/workflowsStore";

import { SECTION_TONES } from "./workflowTones";
import {
  bubbleActionsFor,
  type WorkflowBubbleAction,
  type WorkflowSectionId,
  type WorkflowSectionItem,
} from "./workflowsPanel.logic";

const ACTION_VISUALS: Record<
  WorkflowBubbleAction,
  { label: string; icon: ComponentType<{ className?: string }>; variant: "outline" | "ghost-muted" }
> = {
  schedule: { label: "Schedule", icon: CalendarClockIcon, variant: "ghost-muted" },
  unschedule: { label: "Unschedule", icon: CalendarOffIcon, variant: "ghost-muted" },
  start: { label: "Start", icon: PlayIcon, variant: "outline" },
  pause: { label: "Pause", icon: PauseIcon, variant: "outline" },
  resume: { label: "Resume", icon: PlayIcon, variant: "outline" },
  restart: { label: "Restart", icon: RotateCcwIcon, variant: "outline" },
  view: { label: "View", icon: EyeIcon, variant: "outline" },
};

/** The line under the title: when a run started or finished, or what a definition is for. */
function itemDetail(item: WorkflowSectionItem, sectionId: WorkflowSectionId): string | null {
  if (item.kind === "run") {
    return sectionId === "done" && item.run.finishedAt
      ? `Finished ${formatRelativeTimeLabel(item.run.finishedAt)}`
      : `Started ${formatRelativeTimeLabel(item.run.startedAt)}`;
  }
  if (sectionId === "scheduled" && item.definition.scheduledFor) {
    return `Runs in ${formatRelativeTimeUntilLabel(item.definition.scheduledFor).replace(/ left$/, "")}`;
  }
  return item.definition.description;
}

/**
 * Top-right corner: a bar with percent while a run reports progress, a spinner while it runs
 * without one, and a state glyph once it is paused, awaiting review, done, stuck, or queued.
 */
function BubbleProgress(props: { item: WorkflowSectionItem; sectionId: WorkflowSectionId }) {
  const tone = SECTION_TONES[props.sectionId];
  if (props.item.kind === "definition") {
    return props.sectionId === "scheduled" ? (
      <CalendarClockIcon aria-hidden className={cn("size-3", tone.label)} />
    ) : null;
  }
  const run = props.item.run;
  switch (run.status) {
    case "review":
    case "done":
      return <CheckIcon aria-hidden className={cn("size-3", tone.label)} />;
    case "stuck":
      return <TriangleAlertIcon aria-hidden className={cn("size-3", tone.label)} />;
    case "in-progress":
      if (run.pausedAt !== null) {
        return <PauseIcon aria-hidden className="size-3 text-muted-foreground" />;
      }
      if (run.progress === null) {
        return <Spinner className="size-3 text-muted-foreground" />;
      }
      return <ProgressBar fraction={run.progress} label={`${props.item.name} progress`} />;
  }
}

function ProgressBar(props: { fraction: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, props.fraction)) * 100);
  return (
    <span className="flex items-center gap-1.5">
      <span
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 w-12 overflow-hidden rounded-full bg-muted/60"
      >
        <span
          className="block h-full rounded-full bg-yellow-500 dark:bg-yellow-400"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground">{percent}%</span>
    </span>
  );
}

/** Left of the footer: what the agents are up to, or that they are paused. */
function stageLabel(run: WorkflowRun): string | null {
  if (run.pausedAt !== null) return "Paused";
  return run.stage;
}

/**
 * One workflow in the panel. Title and progress on top, description, then the run's body
 * (activity while it runs, outcome after), then a footer with the stage tag on the left,
 * tokens in the middle, and the section's actions on the right. The border takes the tone
 * of the section the bubble sits in.
 */
export function WorkflowBubble(props: {
  item: WorkflowSectionItem;
  sectionId: WorkflowSectionId;
  /** Overrides the line under the title (history shows "Ran … · 20m" instead). */
  detail?: string | null;
  onAction: (action: WorkflowBubbleAction) => void;
}) {
  const { item, sectionId } = props;
  const tone = SECTION_TONES[sectionId];
  const name = item.kind === "run" ? item.name : item.definition.name;
  const detail = props.detail === undefined ? itemDetail(item, sectionId) : props.detail;
  const run = item.kind === "run" ? item.run : null;
  const stage = run ? stageLabel(run) : null;
  const actions = bubbleActionsFor(sectionId, item);

  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-lg border bg-card/40 px-3 py-2", tone.bubble)}
    >
      <div className="flex items-start gap-2">
        {tone.dot ? (
          <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone.dot)} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {detail ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span>
          ) : null}
        </div>
        <span className="mt-1 flex shrink-0 items-center">
          <BubbleProgress item={item} sectionId={sectionId} />
        </span>
      </div>
      {run?.summary ? (
        <p className="line-clamp-3 text-xs text-foreground/80">{run.summary}</p>
      ) : null}
      <div className="flex items-center gap-2 pt-0.5">
        {stage ? (
          <Badge variant="outline" size="sm" className="shrink-0">
            {stage}
          </Badge>
        ) : null}
        <span className="flex-1 truncate text-center text-[11px] tabular-nums text-muted-foreground">
          {run ? `${formatContextWindowTokens(run.tokens)} tokens` : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {actions.map((action) => {
            const visual = ACTION_VISUALS[action];
            return (
              <Button
                key={action}
                type="button"
                size="xs"
                variant={visual.variant}
                onClick={() => props.onAction(action)}
              >
                <visual.icon className="size-3" />
                {visual.label}
              </Button>
            );
          })}
        </span>
      </div>
    </div>
  );
}
