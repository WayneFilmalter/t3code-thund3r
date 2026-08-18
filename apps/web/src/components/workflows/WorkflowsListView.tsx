import { ChevronRightIcon, PlusIcon, Workflow } from "lucide-react";

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
import { cn } from "~/lib/utils";
import { WORKFLOW_TEMPLATES } from "~/workflows/workflowTemplates";

import { TaskBubble } from "./TaskBubble";
import { WorkflowBubble, type WorkflowDefinitionMenuAction } from "./WorkflowBubble";
import { WorkflowsSubheader } from "./WorkflowsSubheader";
import { SECTION_TONES } from "./workflowTones";
import {
  DONE_PREVIEW_COUNT,
  type WorkflowBubbleAction,
  type WorkflowSection,
  type WorkflowSectionItem,
} from "./workflowsPanel.logic";

export { definitionSummary } from "./WorkflowBubble";

export interface WorkflowsListViewProps {
  hasProject: boolean;
  sections: readonly WorkflowSection[];
  /** Definitions with a run in progress or in review; their Start is disabled. */
  busyDefinitionIds?: ReadonlySet<string> | undefined;
  onCreate: (templateId: string) => void;
  /** Opens the full Done history; the Done section only previews the latest few. */
  onViewHistory: () => void;
  onAction?: ((item: WorkflowSectionItem, action: WorkflowBubbleAction) => void) | undefined;
  onMenuAction?:
    | ((item: WorkflowSectionItem, action: WorkflowDefinitionMenuAction) => void)
    | undefined;
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
          workflows show up in their own sections — and so do this project&apos;s threads while they
          work.
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
                ).map((item) =>
                  item.kind === "task" ? (
                    <TaskBubble
                      key={`task:${item.task.ref.threadId}`}
                      task={item.task}
                      sectionId={section.id}
                      onAction={(action) => props.onAction?.(item, action)}
                    />
                  ) : (
                    <WorkflowBubble
                      key={
                        item.kind === "run"
                          ? `run:${item.run.id}`
                          : `definition:${item.definition.id}`
                      }
                      item={item}
                      sectionId={section.id}
                      busy={
                        item.kind === "definition" &&
                        (props.busyDefinitionIds?.has(item.definition.id) ?? false)
                      }
                      onAction={(action) => props.onAction?.(item, action)}
                      onMenuAction={
                        props.onMenuAction
                          ? (action) => props.onMenuAction?.(item, action)
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
