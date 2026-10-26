import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TaskShell } from "../../workflows/taskItems";
import {
  compareWorkflows,
  deriveWorkflowStatus,
  formatElapsed,
  type WorkflowTask,
  workflowSummary,
} from "./workflowsPanel.logic";

const THREAD = ThreadId.make("thread-run");

function task(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    schedule: { type: "manual" },
    enabled: true,
    nextRunAt: null,
    lastRunAt: "2026-10-26T12:00:00.000Z",
    lastRunStatus: "succeeded",
    lastRunThreadId: THREAD,
    ...overrides,
  };
}

function shell(
  status: "running" | "completed" | "interrupted",
  overrides: Partial<TaskShell> = {},
): TaskShell {
  return {
    environmentId: EnvironmentId.make("local"),
    id: THREAD,
    title: "Sweep",
    latestRun: {
      runId: RunId.make("run-1"),
      status,
      requestedAt: "2026-10-26T12:00:00.000Z",
      startedAt: "2026-10-26T12:00:02.000Z",
      completedAt: status === "running" ? null : "2026-10-26T12:05:00.000Z",
      assistantMessageId: null,
    },
    runtime: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    archivedAt: null,
    updatedAt: "2026-10-26T12:05:00.000Z",
    ...overrides,
  };
}

describe("deriveWorkflowStatus", () => {
  it("is idle before the first run", () => {
    expect(
      deriveWorkflowStatus(task({ lastRunStatus: "never", lastRunThreadId: null }), null).state,
    ).toBe("idle");
  });

  it("counts the server's dispatch as busy before the thread exists", () => {
    const status = deriveWorkflowStatus(task({ lastRunStatus: "running" }), null);
    expect(status).toMatchObject({ state: "dispatching", active: true });
  });

  it("follows the run's thread once dispatched", () => {
    expect(deriveWorkflowStatus(task(), shell("running"))).toMatchObject({
      state: "running",
      active: true,
      startedAt: "2026-10-26T12:00:02.000Z",
      finishedAt: null,
    });
    expect(deriveWorkflowStatus(task(), shell("completed"))).toMatchObject({
      state: "done",
      active: false,
      finishedAt: "2026-10-26T12:05:00.000Z",
    });
    expect(deriveWorkflowStatus(task(), shell("interrupted")).state).toBe("stopped");
    expect(
      deriveWorkflowStatus(task(), shell("running", { hasPendingApprovals: true })).state,
    ).toBe("waiting");
  });

  it("shows a failed dispatch over the thread an earlier run left behind", () => {
    expect(deriveWorkflowStatus(task({ lastRunStatus: "failed" }), shell("completed")).state).toBe(
      "failed",
    );
  });

  it("treats a pending run as a timer only on an enabled on-demand task", () => {
    const at = "2026-10-26T13:00:00.000Z";
    expect(deriveWorkflowStatus(task({ nextRunAt: at }), null).timerAt).toBe(at);
    expect(deriveWorkflowStatus(task({ nextRunAt: at, enabled: false }), null).timerAt).toBeNull();
    expect(
      deriveWorkflowStatus(
        task({ nextRunAt: at, schedule: { type: "interval", everyMs: 3_600_000 } }),
        null,
      ).timerAt,
    ).toBeNull();
  });
});

describe("compareWorkflows", () => {
  it("puts busy runs first, then timers, then the most recently run", () => {
    const entry = (
      title: string,
      overrides: Partial<WorkflowTask>,
      shellState = null as TaskShell | null,
    ) => {
      const value = { ...task(overrides), title };
      return { task: value, status: deriveWorkflowStatus(value, shellState) };
    };
    const ordered = [
      entry("old", { lastRunAt: "2026-10-20T00:00:00.000Z" }),
      entry("never", { lastRunAt: null, lastRunStatus: "never", lastRunThreadId: null }),
      entry("timer", { nextRunAt: "2026-10-26T13:00:00.000Z" }),
      entry("running", {}, shell("running")),
      entry("recent", { lastRunAt: "2026-10-25T00:00:00.000Z" }),
    ]
      .sort(compareWorkflows)
      .map((value) => value.task.title);
    expect(ordered).toEqual(["running", "timer", "recent", "old", "never"]);
  });
});

describe("workflowSummary", () => {
  const base = {
    id: "item",
    threadId: THREAD,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    title: null,
    startedAt: null,
    completedAt: null,
  };
  const assistant = (text: string, ordinal: number) =>
    ({
      ...base,
      ordinal,
      status: "completed",
      type: "assistant_message",
      text,
    }) as unknown as OrchestrationV2TurnItem;
  const command = (input: string, status: string, ordinal: number) =>
    ({
      ...base,
      ordinal,
      status,
      type: "command_execution",
      input,
    }) as unknown as OrchestrationV2TurnItem;

  it("shows a tool the agent is running now over its earlier words", () => {
    expect(
      workflowSummary([
        assistant("Looking at the backlog.", 0),
        command("gh issue list", "running", 1),
      ]),
    ).toBe("$ gh issue list");
  });

  it("falls back to the agent's latest words, on one line", () => {
    expect(
      workflowSummary([
        assistant("First.", 0),
        assistant("Labelled 4 tickets.\n\nCommenting on the rest.", 1),
        command("gh issue list", "completed", 2),
      ]),
    ).toBe("Labelled 4 tickets. Commenting on the rest.");
    expect(workflowSummary([])).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("reads like a stopwatch", () => {
    expect(formatElapsed(12_400)).toBe("12s");
    expect(formatElapsed(192_000)).toBe("3m 12s");
    expect(formatElapsed(3_840_000)).toBe("1h 04m");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
