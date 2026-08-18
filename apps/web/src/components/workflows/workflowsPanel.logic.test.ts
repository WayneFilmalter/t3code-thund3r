import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createAgentNode,
  createEndNode,
  createStartNode,
  type WorkflowDefinition,
  type WorkflowRun,
} from "~/workflowsStore";

import {
  bubbleActionsFor,
  deriveWorkflowSections,
  runProgress,
  runStage,
  runSummary,
  stuckReason,
} from "./workflowsPanel.logic";

const PROJECT_REF = scopeProjectRef(EnvironmentId.make("env"), ProjectId.make("project"));

export function definition(
  overrides: Partial<WorkflowDefinition> & { id: string },
): WorkflowDefinition {
  return {
    name: overrides.id,
    description: null,
    color: "#22d3ee",
    sharedContext: "",
    nodes: [
      createStartNode({ id: `${overrides.id}-start` }),
      createEndNode({ id: `${overrides.id}-end` }),
    ],
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    scheduledFor: null,
    ...overrides,
  };
}

export function run(overrides: Partial<WorkflowRun> & { id: string }): WorkflowRun {
  return {
    definitionId: "audit",
    name: "Nightly audit",
    color: "#22d3ee",
    projectRef: PROJECT_REF,
    snapshot: { sharedContext: "", nodes: [] },
    status: "in-progress",
    pausedAt: null,
    iteration: 0,
    nextIterationAt: null,
    instances: {},
    review: null,
    result: null,
    startedAt: "2026-08-17T11:00:00.000Z",
    finishedAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("deriveWorkflowSections", () => {
  it("returns nothing for an empty project so the panel shows its empty state", () => {
    expect(deriveWorkflowSections({ definitions: [], runs: [] })).toEqual([]);
  });

  it("lists definitions newest first under Workflows and omits empty sections", () => {
    const sections = deriveWorkflowSections({
      definitions: [
        definition({ id: "old", createdAt: "2026-08-16T10:00:00.000Z" }),
        definition({ id: "new", createdAt: "2026-08-17T10:00:00.000Z" }),
      ],
      runs: [],
    });

    expect(sections.map((section) => section.id)).toEqual(["workflows"]);
    expect(
      sections[0]!.items.map((item) => (item.kind === "definition" ? item.definition.id : null)),
    ).toEqual(["new", "old"]);
  });

  it("lists a scheduled definition under both Workflows and Scheduled, soonest first", () => {
    const sections = deriveWorkflowSections({
      definitions: [
        definition({ id: "later", scheduledFor: "2026-08-18T10:00:00.000Z" }),
        definition({ id: "unscheduled" }),
        definition({ id: "sooner", scheduledFor: "2026-08-17T12:00:00.000Z" }),
      ],
      runs: [],
    });

    expect(sections.map((section) => section.id)).toEqual(["workflows", "scheduled"]);
    expect(sections[0]!.items).toHaveLength(3);
    expect(
      sections[1]!.items.map((item) => (item.kind === "definition" ? item.definition.id : null)),
    ).toEqual(["sooner", "later"]);
  });

  it("buckets runs by status in a fixed order, newest first, named after their definition", () => {
    const sections = deriveWorkflowSections({
      definitions: [definition({ id: "audit", name: "Nightly audit" })],
      runs: [
        run({ id: "stuck-1", status: "stuck" }),
        run({
          id: "failed-1",
          status: "failed",
          finishedAt: "2026-08-17T13:00:00.000Z",
          lastError: "boom",
        }),
        run({ id: "cancelled-1", status: "cancelled", finishedAt: "2026-08-17T12:30:00.000Z" }),
        run({ id: "review-1", status: "review", finishedAt: "2026-08-17T12:00:00.000Z" }),
        run({ id: "live-old", startedAt: "2026-08-17T09:00:00.000Z" }),
        run({ id: "live-new", startedAt: "2026-08-17T11:00:00.000Z" }),
        run({ id: "orphan", status: "stuck", definitionId: "gone", name: "Old name" }),
        run({
          id: "done-old",
          status: "done",
          startedAt: "2026-08-10T10:00:00.000Z",
          finishedAt: "2026-08-10T10:30:00.000Z",
        }),
        run({
          id: "done-new",
          status: "done",
          startedAt: "2026-08-09T10:00:00.000Z",
          finishedAt: "2026-08-12T10:30:00.000Z",
        }),
      ],
    });

    expect(sections.map((section) => section.id)).toEqual([
      "workflows",
      "in-progress",
      "review",
      "stuck",
      "done",
    ]);
    const runIds = (id: string) =>
      sections
        .find((section) => section.id === id)!
        .items.map((item) => (item.kind === "run" ? item.run.id : null));
    expect(runIds("in-progress")).toEqual(["live-new", "live-old"]);
    expect(runIds("review")).toEqual(["review-1"]);
    // Failed and cancelled runs land under Stuck too, most recently finished first.
    expect(runIds("stuck")).toEqual(["failed-1", "cancelled-1", "stuck-1", "orphan"]);
    // History orders by when a run finished, not when it started.
    expect(runIds("done")).toEqual(["done-new", "done-old"]);
    const stuck = sections.find((section) => section.id === "stuck")!.items;
    // A run whose definition is gone keeps the name it was started with.
    expect(stuck.map((item) => (item.kind === "run" ? item.name : null))).toEqual([
      "Nightly audit",
      "Nightly audit",
      "Nightly audit",
      "Old name",
    ]);
  });
});

describe("stuckReason / runProgress", () => {
  it("explains why a run sits under Stuck", () => {
    expect(stuckReason(run({ id: "a", status: "cancelled" }))).toBe("Stopped");
    expect(stuckReason(run({ id: "b", status: "failed", lastError: "boom" }))).toBe("boom");
    expect(stuckReason(run({ id: "c", status: "stuck" }))).toBe("Needs attention");
  });

  it("counts done executing nodes of the current iteration", () => {
    const nodes = [
      createStartNode({ id: "s" }),
      createAgentNode("agent", { id: "a" }),
      createEndNode({ id: "e" }),
    ];
    const current = run({
      id: "r",
      snapshot: { sharedContext: "", nodes },
      instances: {
        "s:0": { key: "s:0", nodeId: "s", iteration: 0, status: "done" },
        "a:0": { key: "a:0", nodeId: "a", iteration: 0, status: "running" },
      },
    });
    expect(runProgress(current)).toEqual({ done: 1, total: 3 });
  });

  it("names the running steps as the stage and the outcome as the summary", () => {
    const nodes = [
      createStartNode({ id: "s" }),
      createAgentNode("agent", { id: "a", title: "Research" }),
      createEndNode({ id: "e" }),
    ];
    const running = run({
      id: "r",
      snapshot: { sharedContext: "", nodes },
      instances: {
        "s:0": { key: "s:0", nodeId: "s", iteration: 0, status: "done" },
        "a:0:0": { key: "a:0:0", nodeId: "a", iteration: 0, index: 0, status: "running" },
        "a:0:1": { key: "a:0:1", nodeId: "a", iteration: 0, index: 1, status: "running" },
      },
    });
    expect(runStage(running)).toBe("Research ×2");
    expect(runStage(run({ id: "p", pausedAt: "2026-08-17T12:00:00.000Z" }))).toBe("Paused");
    expect(runStage(run({ id: "n" }))).toBe("Starting");
    expect(runSummary(run({ id: "d", status: "done", result: "All good." }))).toBe("All good.");
    expect(runSummary(run({ id: "f", status: "failed", lastError: "boom" }))).toBe("boom");
    expect(
      runSummary(
        run({ id: "v", status: "review", review: { instanceKey: "r:0", summary: "Look" } }),
      ),
    ).toBe("Look");
  });
});

describe("bubbleActionsFor", () => {
  const item = (overrides: Partial<WorkflowRun>) =>
    ({ kind: "run", run: run({ id: "x", ...overrides }), name: "x" }) as const;
  it("offers the section's actions", () => {
    expect(
      bubbleActionsFor("workflows", { kind: "definition", definition: definition({ id: "d" }) }),
    ).toEqual(["start"]);
    expect(bubbleActionsFor("in-progress", item({}))).toEqual(["pause", "stop", "view"]);
    expect(bubbleActionsFor("in-progress", item({ pausedAt: "2026-08-17T12:00:00.000Z" }))).toEqual(
      ["resume", "stop", "view"],
    );
    expect(bubbleActionsFor("review", item({ status: "review" }))).toEqual([
      "approve",
      "reject",
      "view",
    ]);
    expect(bubbleActionsFor("stuck", item({ status: "failed" }))).toEqual(["restart", "view"]);
    expect(bubbleActionsFor("done", item({ status: "done" }))).toEqual(["view"]);
  });
});
