/**
 * How the Control window's Auto Agents panel reads one: where its last run
 * stands, how long it took, what the agent is saying now, and its timer.
 */
import type { OrchestrationV2TurnItem, ScheduledTask } from "@t3tools/contracts";

import { taskStatus, type TaskShell } from "../../workflows/taskItems";

export type AutoAgentState =
  | "idle"
  | "dispatching"
  | "running"
  | "waiting"
  | "done"
  | "stopped"
  | "failed";

export type AutoAgentTask = Pick<
  ScheduledTask,
  | "schedule"
  | "enabled"
  | "nextRunAt"
  | "timerAt"
  | "lastRunAt"
  | "lastRunStatus"
  | "lastRunThreadId"
>;

export interface AutoAgentStatus {
  readonly state: AutoAgentState;
  /** True while the run's agent is still busy, so the big button stops it. */
  readonly active: boolean;
  /** The armed timer's run, apart from any schedule. */
  readonly timerAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/**
 * A run starts as the server's dispatch (`lastRunStatus: "running"`) and then
 * lives on the thread it went to. A failed dispatch outranks that thread,
 * which may still hold an earlier run.
 */
export function deriveAutoAgentStatus(
  task: AutoAgentTask,
  shell: TaskShell | null,
): AutoAgentStatus {
  const timerAt = task.enabled ? (task.timerAt ?? null) : null;
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
export function compareAutoAgents(
  left: { readonly status: AutoAgentStatus; readonly task: AutoAgentTask & { title: string } },
  right: { readonly status: AutoAgentStatus; readonly task: AutoAgentTask & { title: string } },
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
export function runSummary(items: ReadonlyArray<OrchestrationV2TurnItem>): string | null {
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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The delays offered when creating an Auto Agent and before pressing ▶. */
export const DELAY_PRESETS_MS = [
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  4 * HOUR_MS,
  6 * HOUR_MS,
  8 * HOUR_MS,
  12 * HOUR_MS,
  24 * HOUR_MS,
] as const;

/** `Now`, `5 min`, `2 h`, `1 h 30 min`. */
export function formatDelay(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes <= 0) return "Now";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Now, every preset, and the saved delay when it is not one of them, shortest first. */
export function delayOptions(savedMs: number | null | undefined): ReadonlyArray<number> {
  const options = new Set<number>([0, ...DELAY_PRESETS_MS]);
  if (savedMs != null && savedMs > 0) options.add(savedMs);
  return [...options].toSorted((left, right) => left - right);
}

/** Time left on a timer, to the minute: `under a minute`, `42m`, `1h 42m`. */
export function formatCountdown(ms: number): string {
  const minutes = Math.ceil(ms / MINUTE_MS);
  if (minutes <= 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
}
