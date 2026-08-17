import { describe, expect, it } from "vite-plus/test";

import type { WorkflowDefinition, WorkflowRun } from "~/workflowsStore";

import { createSampleWorkflows } from "./sampleWorkflows";
import { bubbleActionsFor, deriveWorkflowSections } from "./workflowsPanel.logic";

function definition(overrides: Partial<WorkflowDefinition> & { id: string }): WorkflowDefinition {
  return {
    name: overrides.id,
    description: null,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    scheduledFor: null,
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRun> & { id: string }): WorkflowRun {
  return {
    definitionId: "audit",
    status: "in-progress",
    startedAt: "2026-08-17T11:00:00.000Z",
    finishedAt: null,
    pausedAt: null,
    stage: null,
    progress: null,
    tokens: 0,
    summary: null,
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
        run({ id: "review-1", status: "review", finishedAt: "2026-08-17T12:00:00.000Z" }),
        run({ id: "live-old", startedAt: "2026-08-17T09:00:00.000Z" }),
        run({ id: "live-new", startedAt: "2026-08-17T11:00:00.000Z" }),
        run({ id: "orphan", status: "stuck", definitionId: "gone" }),
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
    expect(runIds("stuck")).toEqual(["stuck-1", "orphan"]);
    // History orders by when a run finished, not when it started.
    expect(runIds("done")).toEqual(["done-new", "done-old"]);
    const stuck = sections.find((section) => section.id === "stuck")!.items;
    expect(stuck.map((item) => (item.kind === "run" ? item.name : null))).toEqual([
      "Nightly audit",
      "Deleted workflow",
    ]);
  });

  it("fills every section from the sample workflows", () => {
    const sections = deriveWorkflowSections(createSampleWorkflows(Date.UTC(2026, 7, 17, 12)));
    expect(sections.map((section) => section.id)).toEqual([
      "workflows",
      "scheduled",
      "in-progress",
      "review",
      "stuck",
      "done",
    ]);
    expect(sections.find((section) => section.id === "done")!.items.length).toBeGreaterThan(3);
  });
});

describe("bubbleActionsFor", () => {
  const item = { kind: "definition" as const, definition: definition({ id: "audit" }) };

  it("offers schedule + start in the catalogue and unschedule + start in the queue", () => {
    expect(bubbleActionsFor("workflows", item)).toEqual(["schedule", "start"]);
    expect(bubbleActionsFor("scheduled", item)).toEqual(["unschedule", "start"]);
  });

  it("offers pause while running and resume once paused", () => {
    expect(
      bubbleActionsFor("in-progress", { kind: "run", run: run({ id: "r" }), name: "r" }),
    ).toEqual(["pause"]);
    expect(
      bubbleActionsFor("in-progress", {
        kind: "run",
        run: run({ id: "r", pausedAt: "2026-08-17T11:30:00.000Z" }),
        name: "r",
      }),
    ).toEqual(["resume"]);
  });

  it("offers view for review and done, restart for stuck", () => {
    const runItem = { kind: "run" as const, run: run({ id: "r" }), name: "r" };
    expect(bubbleActionsFor("review", runItem)).toEqual(["view"]);
    expect(bubbleActionsFor("done", runItem)).toEqual(["view"]);
    expect(bubbleActionsFor("stuck", runItem)).toEqual(["restart"]);
  });
});
