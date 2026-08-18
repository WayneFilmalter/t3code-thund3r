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

const DELETED_WORKFLOW_NAME = "Deleted workflow";

/** Why a run sits under Stuck: stopped by hand, failed, or waiting on something in a thread. */
export function stuckReason(run: WorkflowRun): string {
  if (run.status === "cancelled") return "Stopped";
  if (run.status === "failed") return run.lastError ?? "Failed";
  return run.lastError ?? "Needs attention";
}

/** How far the current iteration got: done executing nodes over total, ignoring lane children. */
export function runProgress(run: WorkflowRun): { done: number; total: number } {
  const executing = run.snapshot.nodes.filter((node) => node.kind !== "prompt-block");
  let done = 0;
  for (const node of executing) {
    const instance = run.instances[`${node.id}:${run.iteration}`];
    if (instance?.status === "done" || instance?.status === "skipped") done += 1;
  }
  return { done, total: executing.length };
}

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
    statuses: readonly WorkflowRun["status"][],
    sortKey: (run: WorkflowRun) => string = (run) => run.startedAt,
  ): WorkflowSectionItem[] =>
    project.runs
      .filter((run) => statuses.includes(run.status))
      .sort((left, right) => byNewest(sortKey(left), sortKey(right)))
      .map((run) => ({
        kind: "run",
        run,
        name: nameById.get(run.definitionId) ?? run.name ?? DELETED_WORKFLOW_NAME,
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
    { id: "in-progress", title: "In progress", items: runItems(["in-progress"]) },
    { id: "review", title: "Review", items: runItems(["review"]) },
    {
      id: "stuck",
      title: "Stuck",
      items: runItems(["stuck", "failed", "cancelled"], (run) => run.finishedAt ?? run.startedAt),
    },
    {
      id: "done",
      title: "Done",
      items: runItems(["done"], (run) => run.finishedAt ?? run.startedAt),
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}
