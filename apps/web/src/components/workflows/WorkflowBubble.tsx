import {
  CalendarClockIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "~/timestampFormat";
import type { WorkflowDefinition } from "~/workflowsStore";

import { SECTION_TONES } from "./workflowTones";
import {
  bubbleActionsFor,
  runFraction,
  runProgress,
  runStage,
  runSummary,
  type WorkflowBubbleAction,
  type WorkflowSectionId,
  type WorkflowSectionItem,
} from "./workflowsPanel.logic";

export type WorkflowDefinitionMenuAction = "edit" | "duplicate" | "delete";

const ACTION_VISUALS: Record<
  WorkflowBubbleAction,
  { label: string; icon: ComponentType<{ className?: string }>; variant: "outline" | "ghost-muted" }
> = {
  start: { label: "Start", icon: PlayIcon, variant: "outline" },
  pause: { label: "Pause", icon: PauseIcon, variant: "outline" },
  resume: { label: "Resume", icon: PlayIcon, variant: "outline" },
  stop: { label: "Stop", icon: SquareIcon, variant: "ghost-muted" },
  restart: { label: "Restart", icon: RotateCcwIcon, variant: "outline" },
  approve: { label: "Approve", icon: ThumbsUpIcon, variant: "outline" },
  reject: { label: "Reject", icon: ThumbsDownIcon, variant: "ghost-muted" },
  view: { label: "View", icon: EyeIcon, variant: "ghost-muted" },
};

/** "3 steps · ×5 parallel · loop": what the workflow does, at a glance. */
export function definitionSummary(definition: WorkflowDefinition): string {
  const parts: string[] = [];
  const isStep = (kind: string) => kind !== "start" && kind !== "end" && kind !== "prompt-block";
  const top = definition.nodes.filter((node) => isStep(node.kind));
  const inLanes = definition.nodes.flatMap((node) => (node.kind === "fan-out" ? node.lane : []));
  const total = top.length + inLanes.filter((node) => isStep(node.kind)).length;
  parts.push(`${total} step${total === 1 ? "" : "s"}`);
  const fanOut = definition.nodes.find((node) => node.kind === "fan-out");
  if (fanOut && fanOut.kind === "fan-out") parts.push(`×${fanOut.maxParallel} parallel`);
  const start = definition.nodes.find((node) => node.kind === "start");
  if (start && start.kind === "start" && start.mode === "loop") parts.push("loop");
  if (definition.nodes.some((node) => node.kind === "review")) parts.push("review");
  return parts.join(" · ");
}

/** The line under the title: what a run is up to, or what a definition is for. */
function itemDetail(item: WorkflowSectionItem, sectionId: WorkflowSectionId): string | null {
  if (item.kind === "run") {
    const run = item.run;
    if (sectionId === "done" && run.finishedAt)
      return `Finished ${formatRelativeTimeLabel(run.finishedAt)}`;
    const progress = runProgress(run);
    const iteration = run.iteration > 0 ? `⟲ ${run.iteration + 1} · ` : "";
    return `${iteration}${progress.done}/${progress.total} steps · started ${formatRelativeTimeLabel(run.startedAt)}`;
  }
  if (sectionId === "scheduled" && item.definition.scheduledFor) {
    return `Runs in ${formatRelativeTimeUntilLabel(item.definition.scheduledFor).replace(/ left$/, "")}`;
  }
  return item.definition.description;
}

/**
 * Top-right corner: a bar with percent while a run works, a spinner before its first step,
 * and a state glyph once it is paused, awaiting review, done, stuck, or queued.
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
    case "failed":
    case "cancelled":
      return <TriangleAlertIcon aria-hidden className={cn("size-3", tone.label)} />;
    case "in-progress": {
      if (run.pausedAt !== null) {
        return <PauseIcon aria-hidden className="size-3 text-muted-foreground" />;
      }
      const fraction = runFraction(run);
      if (fraction === 0) return <Spinner className="size-3 text-muted-foreground" />;
      return <ProgressBar fraction={fraction} label={`${props.item.name} progress`} />;
    }
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

/**
 * One workflow in the panel. Title and progress on top, description, then the run's body
 * (the outcome, the review ask, or why it is stuck), then a footer with the stage tag on the
 * left and the section's actions on the right. Definitions wear their own neon colour; runs
 * take the tone of the section they sit in and carry a dot in their workflow's colour.
 */
export function WorkflowBubble(props: {
  item: WorkflowSectionItem;
  sectionId: WorkflowSectionId;
  /** Overrides the line under the title (history shows "Ran … · 20m" instead). */
  detail?: string | null;
  /** Definitions with a run in flight get a disabled Start. */
  busy?: boolean;
  onAction: (action: WorkflowBubbleAction) => void;
  /** Edit / Duplicate / Delete for definitions; omitted when the list is read-only. */
  onMenuAction?: ((action: WorkflowDefinitionMenuAction) => void) | undefined;
}) {
  const { item, sectionId } = props;
  const tone = SECTION_TONES[sectionId];
  const name = item.kind === "run" ? item.name : item.definition.name;
  const detail = props.detail === undefined ? itemDetail(item, sectionId) : props.detail;
  const run = item.kind === "run" ? item.run : null;
  const color = item.kind === "run" ? item.run.color : item.definition.color;
  const stage = item.kind === "run" ? runStage(item.run) : definitionSummary(item.definition);
  const summary = run ? runSummary(run) : null;
  const actions = bubbleActionsFor(sectionId, item);
  const style: CSSProperties | undefined =
    item.kind === "definition"
      ? {
          borderColor: color,
          boxShadow: `0 0 0 1px ${color}22, 0 0 22px -8px ${color}`,
        }
      : undefined;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border bg-card/40 px-3 py-2",
        item.kind === "definition" ? "rounded-2xl" : cn("rounded-lg", tone.bubble),
      )}
      style={style}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px -1px ${color}` }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {detail ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span>
          ) : null}
        </div>
        <span className="mt-1 flex shrink-0 items-center gap-1">
          <BubbleProgress item={item} sectionId={sectionId} />
          {item.kind === "definition" && props.onMenuAction ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    className="-mr-1 -mt-1"
                    aria-label="Workflow actions"
                  />
                }
              >
                <MoreHorizontalIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" className="w-40">
                <MenuItem onClick={() => props.onMenuAction?.("edit")}>
                  <PencilIcon />
                  Edit
                </MenuItem>
                <MenuItem onClick={() => props.onMenuAction?.("duplicate")}>
                  <CopyIcon />
                  Duplicate
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => props.onMenuAction?.("delete")}>
                  <Trash2Icon />
                  Delete
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
        </span>
      </div>
      {summary ? <p className="line-clamp-3 text-xs text-foreground/80">{summary}</p> : null}
      <div className="flex items-center gap-2 pt-0.5">
        {stage ? (
          <Badge variant="outline" size="sm" className="min-w-0 shrink truncate">
            {stage}
          </Badge>
        ) : null}
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-1">
          {actions.map((action) => {
            const visual = ACTION_VISUALS[action];
            const disabled = action === "start" && props.busy === true;
            return (
              <Button
                key={action}
                type="button"
                size="xs"
                variant={visual.variant}
                disabled={disabled}
                aria-label={disabled ? "Already running" : `${visual.label} ${name}`}
                onClick={() => props.onAction(action)}
                style={action === "start" ? { color } : undefined}
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
