import type { ScopedProjectRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronRightIcon, PlusIcon, Workflow } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "~/timestampFormat";
import { selectProjectWorkflows, useWorkflowsStore } from "~/workflowsStore";

import { WorkflowBuilderPanel } from "./WorkflowBuilderPanel";
import { WorkflowHistoryPanel } from "./WorkflowHistoryPanel";
import { WorkflowsSubheader } from "./WorkflowsSubheader";
import {
  DONE_PREVIEW_COUNT,
  deriveWorkflowSections,
  type WorkflowSection,
  type WorkflowSectionItem,
} from "./workflowsPanel.logic";

function NewWorkflowButton(props: { disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="New workflow"
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        <PlusIcon />
      </TooltipTrigger>
      <TooltipPopup>New workflow</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Each section carries the colour of the state it holds so a glance at the rail says what is
 * running, waiting, done, or stuck. The neutral list of built workflows stays grey.
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

function itemDetail(item: WorkflowSectionItem, sectionId: WorkflowSection["id"]): string | null {
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

/** One workflow bubble. Runs grow live details (phases, agents, tokens) here later. */
function WorkflowBubble(props: { item: WorkflowSectionItem; sectionId: WorkflowSection["id"] }) {
  const tone = SECTION_TONES[props.sectionId];
  const name = props.item.kind === "run" ? props.item.name : props.item.definition.name;
  const detail = itemDetail(props.item, props.sectionId);
  return (
    <div
      className={cn("flex items-start gap-2 rounded-lg border bg-card/40 px-3 py-2", tone.bubble)}
    >
      {tone.dot ? (
        <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone.dot)} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  );
}

function WorkflowsEmptyState(props: { hasProject: boolean; onCreate: () => void }) {
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
        <Button size="sm" onClick={props.onCreate}>
          <PlusIcon className="size-3.5" />
          New workflow
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * The list view: header with the "+" entry into the builder, then either the empty state or
 * the project's sections. Kept free of store access so it renders from plain props.
 */
export function WorkflowsListView(props: {
  hasProject: boolean;
  sections: readonly WorkflowSection[];
  onCreate: () => void;
  /** Opens the full Done history; the Done section only previews the latest few. */
  onViewHistory: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          Workflows
        </span>
        <NewWorkflowButton disabled={!props.hasProject} onClick={props.onCreate} />
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
                ).map((item) => (
                  <WorkflowBubble
                    key={
                      item.kind === "run"
                        ? `run:${item.run.id}`
                        : `definition:${item.definition.id}`
                    }
                    item={item}
                    sectionId={section.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Workflows right-panel surface: the project's built workflows, grouped by state, and the
 * entry point into the workflow builder. Workflows are project-scoped, so every thread in a
 * project sees the same list.
 */
export function WorkflowsPanel({
  projectRef,
  timestampFormat,
}: {
  projectRef: ScopedProjectRef | null;
  timestampFormat: TimestampFormat;
}) {
  const [mode, setMode] = useState<"list" | "builder" | "history">("list");
  const project = useWorkflowsStore((state) =>
    selectProjectWorkflows(state.byProjectKey, projectRef),
  );
  const sections = useMemo(() => deriveWorkflowSections(project), [project]);

  if (mode === "builder") {
    return <WorkflowBuilderPanel onBack={() => setMode("list")} />;
  }
  if (mode === "history") {
    return (
      <WorkflowHistoryPanel
        items={sections.find((section) => section.id === "done")?.items ?? []}
        timestampFormat={timestampFormat}
        onBack={() => setMode("list")}
      />
    );
  }
  return (
    <WorkflowsListView
      hasProject={projectRef !== null}
      sections={sections}
      onCreate={() => setMode("builder")}
      onViewHistory={() => setMode("history")}
    />
  );
}
