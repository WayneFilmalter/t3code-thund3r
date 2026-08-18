import {
  ChevronRightIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  Workflow,
} from "lucide-react";
import type { CSSProperties } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "~/timestampFormat";
import { WORKFLOW_TEMPLATES } from "~/workflows/workflowTemplates";
import type { WorkflowDefinition, WorkflowRun } from "~/workflowsStore";

import { WorkflowsSubheader } from "./WorkflowsSubheader";
import {
  DONE_PREVIEW_COUNT,
  runProgress,
  stuckReason,
  type WorkflowSection,
  type WorkflowSectionItem,
} from "./workflowsPanel.logic";

export type WorkflowDefinitionAction = "start" | "edit" | "duplicate" | "delete";
export type WorkflowRunAction = "open" | "stop" | "approve" | "reject";

export interface WorkflowsListViewProps {
  hasProject: boolean;
  sections: readonly WorkflowSection[];
  /** Definitions with a run in progress or in review; their Start is disabled. */
  busyDefinitionIds?: ReadonlySet<string> | undefined;
  onCreate: (templateId: string) => void;
  /** Opens the full Done history; the Done section only previews the latest few. */
  onViewHistory: () => void;
  onDefinitionAction?:
    | ((definition: WorkflowDefinition, action: WorkflowDefinitionAction) => void)
    | undefined;
  onRunAction?: ((run: WorkflowRun, action: WorkflowRunAction) => void) | undefined;
}

function NewWorkflowMenu(props: { disabled: boolean; onCreate: (templateId: string) => void }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="New workflow"
            title="New workflow"
            disabled={props.disabled}
          />
        }
      >
        <PlusIcon />
      </MenuTrigger>
      <MenuPopup align="end" className="w-64">
        {WORKFLOW_TEMPLATES.map((template, index) => (
          <div key={template.id}>
            {index === 2 ? <MenuSeparator /> : null}
            <MenuItem
              onClick={() => props.onCreate(template.id)}
              className="flex-col items-start gap-0 py-1.5"
            >
              <span className="text-sm">{template.label}</span>
              <span className="text-xs text-muted-foreground">{template.description}</span>
            </MenuItem>
          </div>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/**
 * Each section carries the colour of the state it holds so a glance at the rail says what is
 * running, waiting, done, or stuck. Built workflows carry their own colour instead.
 */
const SECTION_TONES: Record<
  WorkflowSection["id"],
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

function WorkflowSectionHeader(props: {
  section: WorkflowSection;
  onViewAll?: (() => void) | undefined;
}) {
  const tone = SECTION_TONES[props.section.id];
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 px-1 first:mt-1">
      <span className={cn("text-xs font-semibold uppercase tracking-wider", tone.label)}>
        {props.section.title}
      </span>
      <span aria-hidden className={cn("h-px flex-1", tone.rule)} />
      <span className={cn("text-xs font-medium tabular-nums", tone.label)}>
        {props.section.items.length}
      </span>
      {props.onViewAll ? (
        <Button
          type="button"
          variant="ghost-muted"
          size="xs"
          className="-my-1 -mr-1 h-5 px-1 text-[.7rem]"
          onClick={props.onViewAll}
        >
          View all
          <ChevronRightIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

/** "3 steps · ×5 parallel · loop": what the workflow does, at a glance. */
export function definitionSummary(definition: WorkflowDefinition): string {
  const parts: string[] = [];
  const steps = definition.nodes.filter(
    (node) => node.kind !== "start" && node.kind !== "end" && node.kind !== "prompt-block",
  );
  const laneSteps = definition.nodes.flatMap((node) => (node.kind === "fan-out" ? node.lane : []));
  const total = steps.length + laneSteps.filter((node) => node.kind !== "prompt-block").length;
  parts.push(`${total} step${total === 1 ? "" : "s"}`);
  const fanOut = definition.nodes.find((node) => node.kind === "fan-out");
  if (fanOut && fanOut.kind === "fan-out") parts.push(`×${fanOut.maxParallel} parallel`);
  const start = definition.nodes.find((node) => node.kind === "start");
  if (start && start.kind === "start" && start.mode === "loop") parts.push("loop");
  if (definition.nodes.some((node) => node.kind === "review")) parts.push("review");
  return parts.join(" · ");
}

function DefinitionBubble(props: {
  definition: WorkflowDefinition;
  busy: boolean;
  scheduled: boolean;
  onAction: ((action: WorkflowDefinitionAction) => void) | undefined;
}) {
  const { definition } = props;
  const style: CSSProperties = {
    borderColor: definition.color,
    boxShadow: `0 0 0 1px ${definition.color}22, 0 0 22px -8px ${definition.color}`,
  };
  const detail =
    props.scheduled && definition.scheduledFor
      ? `Runs in ${formatRelativeTimeUntilLabel(definition.scheduledFor).replace(/ left$/, "")}`
      : definition.description;
  return (
    <div className="flex items-start gap-2 rounded-2xl border bg-card/50 px-3 py-2" style={style}>
      <span
        aria-hidden
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: definition.color, boxShadow: `0 0 8px -1px ${definition.color}` }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{definition.name}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
        <span className="truncate text-[.7rem] text-muted-foreground/80">
          {definitionSummary(definition)}
        </span>
      </div>
      {props.onAction ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={props.busy ? "Already running" : `Start ${definition.name}`}
                  disabled={props.busy}
                  onClick={() => props.onAction?.("start")}
                  style={{ color: definition.color }}
                />
              }
            >
              <PlayIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>{props.busy ? "Already running" : "Start"}</TooltipPopup>
          </Tooltip>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Workflow actions"
                />
              }
            >
              <MoreHorizontalIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-40">
              <MenuItem onClick={() => props.onAction?.("edit")}>
                <PencilIcon />
                Edit
              </MenuItem>
              <MenuItem onClick={() => props.onAction?.("duplicate")}>
                <CopyIcon />
                Duplicate
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => props.onAction?.("delete")}>
                <Trash2Icon />
                Delete
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      ) : null}
    </div>
  );
}

function runDetail(run: WorkflowRun, sectionId: WorkflowSection["id"]): string {
  if (sectionId === "done" && run.finishedAt)
    return `Finished ${formatRelativeTimeLabel(run.finishedAt)}`;
  if (sectionId === "stuck") return stuckReason(run);
  if (sectionId === "review") return run.review?.summary || "Waiting for your review";
  const progress = runProgress(run);
  const iteration = run.iteration > 0 ? `⟲ ${run.iteration + 1} · ` : "";
  return `${iteration}${progress.done}/${progress.total} steps · started ${formatRelativeTimeLabel(run.startedAt)}`;
}

function RunBubble(props: {
  run: WorkflowRun;
  name: string;
  sectionId: WorkflowSection["id"];
  onAction: ((action: WorkflowRunAction) => void) | undefined;
}) {
  const tone = SECTION_TONES[props.sectionId];
  const { run } = props;
  return (
    <div
      className={cn("flex items-start gap-2 rounded-lg border bg-card/40 px-3 py-2", tone.bubble)}
    >
      {tone.dot ? (
        <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone.dot)} />
      ) : null}
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col text-left"
        onClick={() => props.onAction?.("open")}
        aria-label={`Open run of ${props.name}`}
      >
        <span className="truncate text-sm font-medium text-foreground">{props.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {runDetail(run, props.sectionId)}
        </span>
      </button>
      {props.onAction ? (
        <div className="flex shrink-0 items-center gap-1">
          {props.sectionId === "review" ? (
            <>
              <Button
                type="button"
                size="xs"
                className="h-6 px-2"
                onClick={() => props.onAction?.("approve")}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-6 px-2"
                onClick={() => props.onAction?.("reject")}
              >
                Reject
              </Button>
            </>
          ) : null}
          {props.sectionId === "in-progress" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label="Stop run"
                    onClick={() => props.onAction?.("stop")}
                  />
                }
              >
                <SquareIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup>Stop</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowsEmptyState(props: {
  hasProject: boolean;
  onCreate: (templateId: string) => void;
}) {
  if (!props.hasProject) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Workflow className="size-4.5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No project selected</EmptyTitle>
          <EmptyDescription>Open a thread in a project to see its workflows.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <Workflow className="size-4.5 text-muted-foreground" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>No workflows yet</EmptyTitle>
        <EmptyDescription>
          Build a workflow for this project and start it from here. Running, finished, and stuck
          workflows show up in their own sections.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={() => props.onCreate("blank")}>
          <PlusIcon className="size-3.5" />
          New workflow
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * The list view: header with the "+" template menu into the builder, then either the empty
 * state or the project's sections. Kept free of store access so it renders from plain props.
 */
export function WorkflowsListView(props: WorkflowsListViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          Workflows
        </span>
        <NewWorkflowMenu disabled={!props.hasProject} onCreate={props.onCreate} />
      </WorkflowsSubheader>
      {props.sections.length === 0 ? (
        <WorkflowsEmptyState hasProject={props.hasProject} onCreate={props.onCreate} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {props.sections.map((section) => (
            <section key={section.id} aria-label={section.title}>
              <WorkflowSectionHeader
                section={section}
                onViewAll={section.id === "done" ? props.onViewHistory : undefined}
              />
              <div className="flex flex-col gap-1.5">
                {(section.id === "done"
                  ? section.items.slice(0, DONE_PREVIEW_COUNT)
                  : section.items
                ).map((item: WorkflowSectionItem) =>
                  item.kind === "definition" ? (
                    <DefinitionBubble
                      key={`definition:${item.definition.id}`}
                      definition={item.definition}
                      busy={props.busyDefinitionIds?.has(item.definition.id) ?? false}
                      scheduled={section.id === "scheduled"}
                      onAction={
                        props.onDefinitionAction
                          ? (action) => props.onDefinitionAction?.(item.definition, action)
                          : undefined
                      }
                    />
                  ) : (
                    <RunBubble
                      key={`run:${item.run.id}`}
                      run={item.run}
                      name={item.name}
                      sectionId={section.id}
                      onAction={
                        props.onRunAction
                          ? (action) => props.onRunAction?.(item.run, action)
                          : undefined
                      }
                    />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
