import { workflowNodeTitle } from "~/workflows/workflowNodeMeta";
import { findNode } from "~/workflows/workflowRunner.logic";
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
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "restart"
  | "approve"
  | "reject"
  | "view";

/**
 * The buttons a bubble offers, decided by the section it sits in: the catalogue starts, a
 * running run pauses/resumes or stops, a review approves/rejects, a stuck run restarts, and
 * every run can be viewed. Scheduling waits for the server to grow timers.
 */
export function bubbleActionsFor(
  sectionId: WorkflowSectionId,
  item: WorkflowSectionItem,
): readonly WorkflowBubbleAction[] {
  switch (sectionId) {
    case "workflows":
    case "scheduled":
      return ["start"];
    case "in-progress":
      return [
        item.kind === "run" && item.run.pausedAt !== null ? "resume" : "pause",
        "stop",
        "view",
      ];
    case "review":
      return ["approve", "reject", "view"];
    case "stuck":
      return ["restart", "view"];
    case "done":
      return ["view"];
  }
}

/** 0..1 of the current iteration's steps that are done. */
export function runFraction(run: WorkflowRun): number {
  const { done, total } = runProgress(run);
  return total === 0 ? 0 : done / total;
}

/** What the run is doing right now: the running steps' titles, or a paused/waiting label. */
export function runStage(run: WorkflowRun): string | null {
  if (run.status !== "in-progress") return null;
  if (run.pausedAt !== null) return "Paused";
  if (run.nextIterationAt) return "Waiting for next iteration";
  const titles = new Map<string, number>();
  for (const instance of Object.values(run.instances)) {
    if (instance.iteration !== run.iteration || instance.status !== "running") continue;
    const node = findNode(run.snapshot.nodes, instance.nodeId);
    if (!node || node.kind === "fan-out") continue;
    const title = workflowNodeTitle(node);
    titles.set(title, (titles.get(title) ?? 0) + 1);
  }
  if (titles.size === 0) return "Starting";
  return [...titles.entries()]
    .map(([title, count]) => (count > 1 ? `${title} ×${count}` : title))
    .join(", ");
}

/** The bubble body: the outcome once finished, the reason when stuck, the ask when in review. */
export function runSummary(run: WorkflowRun): string | null {
  switch (run.status) {
    case "done":
      return run.result;
    case "review":
      return run.review?.summary || "Waiting for your review";
    case "stuck":
    case "failed":
    case "cancelled":
      return stuckReason(run);
    case "in-progress":
      return null;
  }
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
