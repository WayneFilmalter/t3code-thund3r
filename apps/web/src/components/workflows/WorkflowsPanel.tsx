import type { ScopedProjectRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ChevronRightIcon, PlusIcon, Workflow } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
import { selectProjectWorkflows, useWorkflowsStore } from "~/workflowsStore";

import { WorkflowBubble } from "./WorkflowBubble";
import { WorkflowBuilderPanel } from "./WorkflowBuilderPanel";
import { WorkflowHistoryPanel } from "./WorkflowHistoryPanel";
import { WorkflowsSubheader } from "./WorkflowsSubheader";
import { SECTION_TONES } from "./workflowTones";
import {
  DONE_PREVIEW_COUNT,
  deriveWorkflowSections,
  type WorkflowBubbleAction,
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
  onAction: (item: WorkflowSectionItem, action: WorkflowBubbleAction) => void;
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
                    onAction={(action) => props.onAction(item, action)}
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

  const onAction = useCallback(
    (item: WorkflowSectionItem, action: WorkflowBubbleAction) => {
      if (!projectRef) return;
      const store = useWorkflowsStore.getState();
      switch (action) {
        case "start":
          store.startRun(
            projectRef,
            item.kind === "run" ? item.run.definitionId : item.definition.id,
          );
          return;
        case "schedule":
          if (item.kind === "definition") {
            store.setSchedule(
              projectRef,
              item.definition.id,
              new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            );
          }
          return;
        case "unschedule":
          if (item.kind === "definition") store.setSchedule(projectRef, item.definition.id, null);
          return;
        case "pause":
          if (item.kind === "run") store.pauseRun(projectRef, item.run.id);
          return;
        case "resume":
          if (item.kind === "run") store.resumeRun(projectRef, item.run.id);
          return;
        case "restart":
          if (item.kind === "run") store.restartRun(projectRef, item.run.id);
          return;
        case "view":
          // Nothing to open yet; the run view lands with real workflows.
          return;
      }
    },
    [projectRef],
  );

  if (mode === "builder") {
    return <WorkflowBuilderPanel onBack={() => setMode("list")} />;
  }
  if (mode === "history") {
    return (
      <WorkflowHistoryPanel
        items={sections.find((section) => section.id === "done")?.items ?? []}
        timestampFormat={timestampFormat}
        onBack={() => setMode("list")}
        onAction={onAction}
      />
    );
  }
  return (
    <WorkflowsListView
      hasProject={projectRef !== null}
      sections={sections}
      onCreate={() => setMode("builder")}
      onViewHistory={() => setMode("history")}
      onAction={onAction}
    />
  );
}
