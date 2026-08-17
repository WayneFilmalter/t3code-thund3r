import type { WorkflowDefinition, WorkflowProjectState, WorkflowRun } from "~/workflowsStore";

export type WorkflowSectionId =
  | "workflows"
  | "scheduled"
  | "in-progress"
  | "review"
  | "stuck"
  | "done";

/** How many finished runs the Done section shows before "View all" opens the history. */
export const DONE_PREVIEW_COUNT = 3;

export type WorkflowSectionItem =
  | { kind: "definition"; definition: WorkflowDefinition }
  | { kind: "run"; run: WorkflowRun; name: string };

export interface WorkflowSection {
  id: WorkflowSectionId;
  title: string;
  items: WorkflowSectionItem[];
}

export type WorkflowBubbleAction =
  | "schedule"
  | "unschedule"
  | "start"
  | "pause"
  | "resume"
  | "restart"
  | "view";

/**
 * The buttons a bubble offers, decided by the section it sits in: the catalogue schedules or
 * starts, the queue unschedules or starts now, a run pauses/resumes, is viewed, or restarts.
 */
export function bubbleActionsFor(
  sectionId: WorkflowSectionId,
  item: WorkflowSectionItem,
): readonly WorkflowBubbleAction[] {
  switch (sectionId) {
    case "workflows":
      return ["schedule", "start"];
    case "scheduled":
      return ["unschedule", "start"];
    case "in-progress":
      return item.kind === "run" && item.run.pausedAt !== null ? ["resume"] : ["pause"];
    case "stuck":
      return ["restart"];
    case "review":
    case "done":
      return ["view"];
  }
}

const DELETED_WORKFLOW_NAME = "Deleted workflow";

const byNewest = (left: string, right: string) => right.localeCompare(left);

/**
 * The panel's sections in display order, empty ones dropped. An empty result means the
 * project has nothing to list and the panel shows its empty state instead.
 */
export function deriveWorkflowSections(project: WorkflowProjectState): WorkflowSection[] {
  const nameById = new Map(
    project.definitions.map((definition) => [definition.id, definition.name]),
  );
  const definitionItems = (definitions: readonly WorkflowDefinition[]): WorkflowSectionItem[] =>
    definitions.map((definition) => ({ kind: "definition", definition }));
  const runItems = (
    status: WorkflowRun["status"],
    sortKey: (run: WorkflowRun) => string = (run) => run.startedAt,
  ): WorkflowSectionItem[] =>
    project.runs
      .filter((run) => run.status === status)
      .sort((left, right) => byNewest(sortKey(left), sortKey(right)))
      .map((run) => ({
        kind: "run",
        run,
        name: nameById.get(run.definitionId) ?? DELETED_WORKFLOW_NAME,
      }));

  const sections: WorkflowSection[] = [
    {
      id: "workflows",
      title: "Workflows",
      items: definitionItems(
        [...project.definitions].sort((left, right) => byNewest(left.createdAt, right.createdAt)),
      ),
    },
    {
      id: "scheduled",
      title: "Scheduled",
      items: definitionItems(
        project.definitions
          .filter(
            (definition): definition is WorkflowDefinition & { scheduledFor: string } =>
              definition.scheduledFor !== null,
          )
          .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor)),
      ),
    },
    { id: "in-progress", title: "In progress", items: runItems("in-progress") },
    { id: "review", title: "Review", items: runItems("review") },
    { id: "stuck", title: "Stuck", items: runItems("stuck") },
    {
      id: "done",
      title: "Done",
      items: runItems("done", (run) => run.finishedAt ?? run.startedAt),
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}
