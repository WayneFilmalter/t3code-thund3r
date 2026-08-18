import type { ScopedProjectRef } from "@t3tools/contracts";

import { findWorkflowTemplate } from "~/workflows/workflowTemplates";
import type { WorkflowDefinition, WorkflowProjectState, WorkflowRun } from "~/workflowsStore";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A project's worth of stand-in workflows, one or more per panel section, for tests and for
 * looking at every bubble state. Timestamps hang off `nowMs` so relative labels stay alive
 * whenever it is loaded. Nothing in the components imports this; load it into the store
 * yourself, e.g. `useWorkflowsStore.setState({ byProjectKey: { [key]: createSampleWorkflows(Date.now(), ref) } })`.
 */
export function createSampleWorkflows(
  nowMs: number,
  projectRef: ScopedProjectRef,
): WorkflowProjectState {
  const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();
  const fromTemplate = (
    templateId: string,
    id: string,
    createdOffsetMs: number,
  ): WorkflowDefinition => {
    const input = findWorkflowTemplate(templateId)!.build();
    return {
      id,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? "#22d3ee",
      sharedContext: input.sharedContext ?? "",
      nodes: input.nodes ?? [],
      createdAt: at(createdOffsetMs),
      updatedAt: at(createdOffsetMs),
      scheduledFor: null,
    };
  };
  const backlog = fromTemplate("backlog-follow-up", "sample-backlog", -6 * DAY);
  const sweep = fromTemplate("whole-backlog", "sample-sweep", -5 * DAY);
  const ship = fromTemplate("implement-by-tag", "sample-ship", -4 * DAY);
  const single = fromTemplate("single-prompt", "sample-single", -2 * DAY);

  const run = (
    id: string,
    definition: WorkflowDefinition,
    fields: Partial<WorkflowRun> & Pick<WorkflowRun, "status" | "startedAt">,
  ): WorkflowRun => ({
    id,
    definitionId: definition.id,
    name: definition.name,
    color: definition.color,
    projectRef,
    snapshot: { sharedContext: definition.sharedContext, nodes: definition.nodes },
    pausedAt: null,
    iteration: 0,
    nextIterationAt: null,
    instances: {},
    review: null,
    result: null,
    finishedAt: null,
    lastError: null,
    ...fields,
  });
  const startId = (definition: WorkflowDefinition) => definition.nodes[0]!.id;
  const secondId = (definition: WorkflowDefinition) => definition.nodes[1]!.id;

  return {
    definitions: [backlog, sweep, ship, single],
    runs: [
      run("sample-run-backlog", backlog, {
        status: "in-progress",
        startedAt: at(-12 * MINUTE),
        instances: {
          [`${startId(backlog)}:0`]: {
            key: `${startId(backlog)}:0`,
            nodeId: startId(backlog),
            iteration: 0,
            status: "done",
          },
          [`${secondId(backlog)}:0`]: {
            key: `${secondId(backlog)}:0`,
            nodeId: secondId(backlog),
            iteration: 0,
            status: "running",
            startedAt: at(-11 * MINUTE),
          },
        },
      }),
      run("sample-run-sweep", sweep, {
        status: "in-progress",
        startedAt: at(-40 * MINUTE),
        pausedAt: at(-3 * MINUTE),
        iteration: 2,
      }),
      run("sample-run-ship", ship, {
        status: "review",
        startedAt: at(-2 * HOUR),
        review: {
          instanceKey: "review:0",
          summary: "3 PRs opened. Approve to let the agents comment on the tickets.",
        },
      }),
      run("sample-run-single-stuck", single, {
        status: "failed",
        startedAt: at(-3 * HOUR),
        finishedAt: at(-2 * HOUR),
        lastError: "The agent did not end with a fenced ```json block.",
      }),
      run("sample-run-single-done", single, {
        status: "done",
        startedAt: at(-1 * DAY),
        finishedAt: at(-1 * DAY + 22 * MINUTE),
        result: "Fixed 9 links and 2 stale paths.",
      }),
      run("sample-run-single-done-2", single, {
        status: "done",
        startedAt: at(-2 * DAY),
        finishedAt: at(-2 * DAY + 18 * MINUTE),
        result: "Nothing to fix this time.",
      }),
    ],
  };
}
