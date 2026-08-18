import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveTasks, TASK_DONE_WINDOW_MS, workflowThreadIds } from "./taskItems";
import { bubbleActionsFor, deriveWorkflowSections } from "./workflowsPanel.logic";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function shell(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    environmentId: EnvironmentId.make("env"),
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    title: `Thread ${id}`,
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: at(-60 * 60_000),
    updatedAt: at(-60 * 60_000),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const runningTurn = (offsetMs: number) => ({
  turnId: TurnId.make("t"),
  state: "running" as const,
  requestedAt: at(offsetMs),
  startedAt: at(offsetMs),
  completedAt: null,
  assistantMessageId: null,
});
const settledTurn = (state: "completed" | "interrupted" | "error", offsetMs: number) => ({
  turnId: TurnId.make("t"),
  state,
  requestedAt: at(offsetMs - 60_000),
  startedAt: at(offsetMs - 60_000),
  completedAt: at(offsetMs),
  assistantMessageId: null,
});

describe("deriveTasks", () => {
  it("classifies threads by what they are doing and skips archived, untouched and workflow threads", () => {
    const tasks = deriveTasks(
      [
        shell("running", {
          latestTurn: runningTurn(-5 * 60_000),
          session: {
            threadId: ThreadId.make("running"),
            status: "running",
            providerName: "claude",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("t"),
            lastError: null,
            updatedAt: at(-1000),
          },
          planProgress: { step: "Writing tests", completedSteps: 2, totalSteps: 5 },
          updatedAt: at(-1000),
        }),
        shell("approval", {
          latestTurn: runningTurn(-9 * 60_000),
          hasPendingApprovals: true,
          updatedAt: at(-2000),
        }),
        shell("plan", {
          latestTurn: settledTurn("completed", -3 * 60_000),
          hasActionableProposedPlan: true,
          updatedAt: at(-3000),
        }),
        shell("stopped", {
          latestTurn: settledTurn("interrupted", -10 * 60_000),
          updatedAt: at(-4000),
        }),
        shell("errored", { latestTurn: settledTurn("error", -20 * 60_000), updatedAt: at(-5000) }),
        shell("done", { latestTurn: settledTurn("completed", -30 * 60_000), updatedAt: at(-6000) }),
        shell("old", {
          latestTurn: settledTurn("completed", -TASK_DONE_WINDOW_MS - 1),
          updatedAt: at(-7000),
        }),
        shell("archived", { latestTurn: runningTurn(-1000), archivedAt: at(-500) }),
        shell("untouched"),
        shell("workflow", { latestTurn: runningTurn(-1000), updatedAt: at(0) }),
      ],
      { nowMs: NOW, excludeThreadIds: new Set(["workflow"]) },
    );
    expect(tasks.map((task) => [task.ref.threadId, task.status, task.attention])).toEqual([
      ["running", "running", null],
      ["approval", "attention", "approval"],
      ["plan", "attention", "plan"],
      ["stopped", "stopped", null],
      ["errored", "failed", null],
      ["done", "done", null],
    ]);
    expect(tasks[0]!.progress).toEqual({ step: "Writing tests", completed: 2, total: 5 });
    expect(tasks[3]!.finishedAt).toBe(at(-10 * 60_000));
  });

  it("collects the thread ids a run's instances own", () => {
    expect(
      [
        ...workflowThreadIds([
          {
            instances: {
              a: { thread: { threadId: "t-1" } },
              b: {},
              c: { thread: { threadId: "t-2" } },
            },
          },
        ]),
      ].sort(),
    ).toEqual(["t-1", "t-2"]);
  });

  it("lands tasks in the section matching their status and offers Stop/Resume/Open", () => {
    const tasks = deriveTasks(
      [
        shell("running", { latestTurn: runningTurn(-1000), updatedAt: at(-1000) }),
        shell("stopped", { latestTurn: settledTurn("interrupted", -2000), updatedAt: at(-2000) }),
        shell("input", {
          latestTurn: runningTurn(-3000),
          hasPendingUserInput: true,
          updatedAt: at(-3000),
        }),
        shell("done", { latestTurn: settledTurn("completed", -4000), updatedAt: at(-4000) }),
      ],
      { nowMs: NOW },
    );
    const sections = deriveWorkflowSections({ definitions: [], runs: [] }, tasks);
    expect(sections.map((section) => section.id)).toEqual([
      "in-progress",
      "review",
      "stuck",
      "done",
    ]);
    const first = (id: string) => sections.find((section) => section.id === id)!.items[0]!;
    expect(first("in-progress")).toMatchObject({ kind: "task", task: { status: "running" } });
    expect(first("review")).toMatchObject({ kind: "task", task: { attention: "input" } });
    expect(bubbleActionsFor("in-progress", first("in-progress"))).toEqual(["stop", "view"]);
    expect(bubbleActionsFor("stuck", first("stuck"))).toEqual(["resume", "view"]);
    expect(bubbleActionsFor("review", first("review"))).toEqual(["view"]);
    expect(bubbleActionsFor("done", first("done"))).toEqual(["view"]);
  });
});
