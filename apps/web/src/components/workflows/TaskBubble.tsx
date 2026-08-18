import {
  CheckIcon,
  EyeIcon,
  MessageCircleQuestionIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import type { TaskItem } from "./taskItems";
import { SECTION_TONES } from "./workflowTones";
import {
  bubbleActionsFor,
  type WorkflowBubbleAction,
  type WorkflowSectionId,
} from "./workflowsPanel.logic";

const ACTION_VISUALS: Partial<
  Record<
    WorkflowBubbleAction,
    {
      label: string;
      icon: ComponentType<{ className?: string }>;
      variant: "outline" | "ghost-muted";
    }
  >
> = {
  stop: { label: "Stop", icon: SquareIcon, variant: "outline" },
  resume: { label: "Resume", icon: PlayIcon, variant: "outline" },
  view: { label: "Open", icon: EyeIcon, variant: "ghost-muted" },
};

const ATTENTION_LABELS = {
  approval: "Needs your approval",
  input: "Waiting for your answer",
  plan: "Plan ready to implement",
} as const;

/** The line under the title: what the thread is doing, or how it ended. */
export function taskDetail(task: TaskItem): string {
  const when = task.finishedAt ? ` ${formatRelativeTimeLabel(task.finishedAt)}` : "";
  switch (task.status) {
    case "running":
      return `Working · started ${formatRelativeTimeLabel(task.startedAt)}`;
    case "attention":
      return ATTENTION_LABELS[task.attention ?? "input"];
    case "stopped":
      return `Stopped${when}`;
    case "failed":
      return `Errored${when}`;
    case "done":
      return `Finished${when}`;
  }
}

/** Footer tag: the provider's current plan step, or that agents are still working in the back. */
function taskStage(task: TaskItem): string | null {
  if (task.progress?.step) return task.progress.step;
  if (task.background === "working") return "Agents working";
  if (task.background === "monitoring") return "Watching";
  return null;
}

function TaskProgress(props: { task: TaskItem; sectionId: WorkflowSectionId }) {
  const tone = SECTION_TONES[props.sectionId];
  const { task } = props;
  switch (task.status) {
    case "attention":
      return <MessageCircleQuestionIcon aria-hidden className={cn("size-3", tone.label)} />;
    case "done":
      return <CheckIcon aria-hidden className={cn("size-3", tone.label)} />;
    case "stopped":
    case "failed":
      return <TriangleAlertIcon aria-hidden className={cn("size-3", tone.label)} />;
    case "running": {
      if (task.progress && task.progress.total > 0) {
        const percent = Math.round(
          Math.min(1, Math.max(0, task.progress.completed / task.progress.total)) * 100,
        );
        return (
          <span className="flex items-center gap-1.5">
            <span
              role="progressbar"
              aria-label={`${task.title} progress`}
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
      return <Spinner className="size-3 text-muted-foreground" />;
    }
  }
}

/**
 * A task is one of the project's own threads, tracked here so the main chats and their agents
 * sit beside the workflow runs. Lighter than a run bubble: title, what it is doing, a plan step
 * or "agents working" tag, and Stop / Resume / Open. Border takes the section's tone.
 */
export function TaskBubble(props: {
  task: TaskItem;
  sectionId: WorkflowSectionId;
  onAction: (action: WorkflowBubbleAction) => void;
}) {
  const { task, sectionId } = props;
  const tone = SECTION_TONES[sectionId];
  const stage = taskStage(task);
  const actions = bubbleActionsFor(sectionId, { kind: "task", task });
  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-lg border bg-card/40 px-3 py-2", tone.bubble)}
    >
      <div className="flex items-start gap-2">
        {tone.dot ? (
          <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone.dot)} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{task.title}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{taskDetail(task)}</span>
        </div>
        <span className="mt-1 flex shrink-0 items-center">
          <TaskProgress task={task} sectionId={sectionId} />
        </span>
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <Badge variant="outline" size="sm" className="shrink-0">
          Task
        </Badge>
        {stage ? (
          <Badge variant="outline" size="sm" className="min-w-0 shrink truncate">
            {stage}
          </Badge>
        ) : null}
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-1">
          {actions.map((action) => {
            const visual = ACTION_VISUALS[action];
            if (!visual) return null;
            return (
              <Button
                key={action}
                type="button"
                size="xs"
                variant={visual.variant}
                aria-label={`${visual.label} ${task.title}`}
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
