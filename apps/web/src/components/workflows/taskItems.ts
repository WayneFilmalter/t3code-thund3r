/**
 * Tasks: the project's own threads, tracked in the Workflows panel so what the main chats and
 * their agents are doing sits next to the workflow runs. Nothing is persisted — a task is a
 * live view over a thread shell. Threads a workflow spawned are left out; their run tracks them.
 */
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * `running` while the turn works · `attention` when it waits on an approval, an answer, or a
 * plan decision · `stopped` after an interrupt · `failed` when the turn errored · `done` once
 * the turn completed. Finished tasks age out of the panel after `TASK_DONE_WINDOW_MS`.
 */
export type TaskStatus = "running" | "attention" | "stopped" | "failed" | "done";
export type TaskAttention = "approval" | "input" | "plan";

/** The slice of a thread shell tasks read; tests build this instead of a full shell. */
export type TaskShell = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "latestRun"
  | "runtime"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "pendingBackgroundTasks"
  | "archivedAt"
  | "updatedAt"
>;

export interface TaskItem {
  ref: ScopedThreadRef;
  title: string;
  status: TaskStatus;
  attention: TaskAttention | null;
  /** When the current/last turn was requested; the task's age. */
  startedAt: string;
  /** When the last turn settled, null while it runs. */
  finishedAt: string | null;
  /** Provider plan progress while a turn runs: current step and completed/total. */
  progress: { step: string; completed: number; total: number } | null;
  /** Native subagents/watchers still alive on the thread. */
  background: "working" | "monitoring" | null;
  /** Wall time the thread's latest activity is measured from. */
  updatedAt: string;
}

/** Finished tasks stay listed this long after settling; older ones belong to the thread list. */
export const TASK_DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

function taskStatus(shell: TaskShell): {
  status: TaskStatus;
  attention: TaskAttention | null;
} {
  if (shell.hasPendingApprovals) return { status: "attention", attention: "approval" };
  if (shell.hasPendingUserInput) return { status: "attention", attention: "input" };
  const run = shell.latestRun;
  const running =
    threadRuntimeIsActive(shell.runtime) ||
    (run !== null &&
      run.status !== "completed" &&
      run.status !== "interrupted" &&
      run.status !== "failed" &&
      run.status !== "cancelled" &&
      run.status !== "rolled_back");
  if (running) return { status: "running", attention: null };
  if (shell.hasActionableProposedPlan) return { status: "attention", attention: "plan" };
  if (!run) return { status: "done", attention: null };
  if (run.status === "interrupted" || run.status === "cancelled" || run.status === "rolled_back")
    return { status: "stopped", attention: null };
  if (run.status === "failed") return { status: "failed", attention: null };
  return { status: "done", attention: null };
}

/**
 * The project's threads worth tracking right now: anything running or waiting on you, plus
 * threads that stopped, failed, or finished within the done window. Newest activity first.
 */
export function deriveTasks(
  shells: ReadonlyArray<TaskShell>,
  options: { nowMs: number; excludeThreadIds?: ReadonlySet<string> | undefined },
): TaskItem[] {
  const tasks: TaskItem[] = [];
  for (const shell of shells) {
    if (shell.archivedAt) continue;
    if (options.excludeThreadIds?.has(shell.id)) continue;
    if (!shell.latestRun && !shell.runtime) continue;
    const { status, attention } = taskStatus(shell);
    const run = shell.latestRun;
    const finishedAt =
      status === "running" || status === "attention" ? null : (run?.completedAt ?? null);
    if (
      (status === "done" || status === "stopped" || status === "failed") &&
      (!finishedAt || options.nowMs - Date.parse(finishedAt) > TASK_DONE_WINDOW_MS)
    ) {
      continue;
    }
    tasks.push({
      ref: { environmentId: shell.environmentId, threadId: shell.id },
      title: shell.title,
      status,
      attention,
      startedAt: run?.requestedAt ?? shell.updatedAt,
      finishedAt,
      // The V2 shell no longer carries per-step plan progress; the bubble shows status only.
      progress: null,
      background: shell.pendingBackgroundTasks.length > 0 ? "working" : null,
      updatedAt: shell.updatedAt,
    });
  }
  return tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Thread ids a workflow run created, so tasks never double-list them. */
export function workflowThreadIds(
  runs: ReadonlyArray<{ instances: Record<string, { thread?: { threadId: string } | undefined }> }>,
): Set<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    for (const instance of Object.values(run.instances)) {
      if (instance.thread) ids.add(instance.thread.threadId);
    }
  }
  return ids;
}
