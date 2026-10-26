/**
 * How the Control window's Workflows panel reads a scheduled task: where its
 * last run stands, how long it took, and what the agent is saying now.
 */
import type { OrchestrationV2TurnItem, ScheduledTask } from "@t3tools/contracts";

import { taskStatus, type TaskShell } from "../../workflows/taskItems";

export type WorkflowState =
  | "idle"
  | "dispatching"
  | "running"
  | "waiting"
  | "done"
  | "stopped"
  | "failed";

export type WorkflowTask = Pick<
  ScheduledTask,
  "schedule" | "enabled" | "nextRunAt" | "lastRunAt" | "lastRunStatus" | "lastRunThreadId"
>;

export interface WorkflowStatus {
  readonly state: WorkflowState;
  /** True while the run's agent is still busy, so the big button stops it. */
  readonly active: boolean;
  /** A one-off timer: an on-demand task's pending run. Timed tasks show their schedule instead. */
  readonly timerAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/**
 * A run starts as the server's dispatch (`lastRunStatus: "running"`) and then
 * lives on the thread it went to. A failed dispatch outranks that thread,
 * which may still hold an earlier run.
 */
export function deriveWorkflowStatus(task: WorkflowTask, shell: TaskShell | null): WorkflowStatus {
  const timerAt = task.schedule.type === "manual" && task.enabled ? task.nextRunAt : null;
  if (task.lastRunStatus === "running") {
    return {
      state: "dispatching",
      active: true,
      timerAt,
      startedAt: task.lastRunAt,
      finishedAt: null,
    };
  }
  if (task.lastRunStatus === "failed") {
    return {
      state: "failed",
      active: false,
      timerAt,
      startedAt: task.lastRunAt,
      finishedAt: task.lastRunAt,
    };
  }
  if (task.lastRunStatus === "never" || shell === null) {
    return { state: "idle", active: false, timerAt, startedAt: null, finishedAt: null };
  }
  const run = shell.latestRun;
  const startedAt =
    shell.runtime?.activityStartedAt ?? run?.startedAt ?? run?.requestedAt ?? task.lastRunAt;
  const { status } = taskStatus(shell);
  if (status === "running" || status === "attention") {
    return {
      state: status === "running" ? "running" : "waiting",
      active: true,
      timerAt,
      startedAt,
      finishedAt: null,
    };
  }
  return {
    state: status,
    active: false,
    timerAt,
    startedAt: run?.startedAt ?? run?.requestedAt ?? task.lastRunAt,
    finishedAt: run?.completedAt ?? null,
  };
}

/** Busy runs first, then armed timers, then the most recently run; never-run last. */
export function compareWorkflows(
  left: { readonly status: WorkflowStatus; readonly task: WorkflowTask & { title: string } },
  right: { readonly status: WorkflowStatus; readonly task: WorkflowTask & { title: string } },
): number {
  const rank = (entry: typeof left) =>
    entry.status.active ? 0 : entry.status.timerAt !== null ? 1 : 2;
  return (
    rank(left) - rank(right) ||
    (right.task.lastRunAt ?? "").localeCompare(left.task.lastRunAt ?? "") ||
    left.task.title.localeCompare(right.task.title)
  );
}

const SUMMARY_MAX_LENGTH = 240;

function compact(text: string): string | null {
  const line = text.replace(/\s+/gu, " ").trim();
  if (line.length === 0) return null;
  return line.length > SUMMARY_MAX_LENGTH
    ? `${line.slice(0, SUMMARY_MAX_LENGTH).trimEnd()}…`
    : line;
}

function toolLabel(item: OrchestrationV2TurnItem): string | null {
  switch (item.type) {
    case "command_execution":
      return item.title ?? `$ ${item.input}`;
    case "file_change":
      return item.title ?? "Editing files";
    case "file_search":
      return item.title ?? (item.pattern ? `Searching for ${item.pattern}` : "Searching files");
    case "web_search":
      return item.title ?? "Searching the web";
    case "dynamic_tool":
      return item.title ?? item.toolName ?? "Using a tool";
    default:
      return null;
  }
}

/**
 * What the agent is doing, in one line: a tool it is running right now, or
 * failing that its latest words. Null before it has said or done anything.
 */
export function workflowSummary(items: ReadonlyArray<OrchestrationV2TurnItem>): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.type === "assistant_message") {
      const text = compact(item.text);
      if (text !== null) return text;
      continue;
    }
    if (item.status === "running" || item.status === "pending") {
      const label = toolLabel(item);
      if (label !== null) return compact(label);
    }
  }
  return null;
}

/** `12s`, `3m 12s`, `1h 04m`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The start choices, a timer counting from the press. */
export const START_DELAYS = [
  { value: "now", label: "Now", ms: 0 },
  { value: "5m", label: "In 5 min", ms: 5 * 60_000 },
  { value: "15m", label: "In 15 min", ms: 15 * 60_000 },
  { value: "30m", label: "In 30 min", ms: 30 * 60_000 },
  { value: "1h", label: "In 1 h", ms: 60 * 60_000 },
  { value: "2h", label: "In 2 h", ms: 2 * 60 * 60_000 },
  { value: "4h", label: "In 4 h", ms: 4 * 60 * 60_000 },
  { value: "8h", label: "In 8 h", ms: 8 * 60 * 60_000 },
] as const;
export type StartDelay = (typeof START_DELAYS)[number]["value"];
