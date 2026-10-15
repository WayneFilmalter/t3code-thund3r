import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

/**
 * Coarse thread state for the dot beside the thread name in the chat header.
 * Decision order mirrors `resolveSidebarThreadStatus` so the header never
 * disagrees with the sidebar; the vocabulary is smaller on purpose.
 */
export type ThreadActivityKind = "waiting" | "busy" | "broken" | "done" | "stale";

type ThreadActivityInput = Pick<
  EnvironmentThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput" | "runtime" | "latestRun"
>;

export function resolveThreadActivityKind(thread: ThreadActivityInput): ThreadActivityKind {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "waiting";
  const runtimeStatus = thread.runtime?.status;
  switch (runtimeStatus) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
    case "waiting":
    // Parked on background work that will wake the agent, so still busy.
    case "idle":
      return "busy";
    case "failed":
      return "broken";
    default:
      break;
  }
  if (thread.latestRun?.status === "completed") return "done";
  // Never ran, or the last turn was interrupted, cancelled, or rolled back.
  return "stale";
}

export function threadActivityLabel(thread: ThreadActivityInput): string {
  switch (resolveThreadActivityKind(thread)) {
    case "waiting":
      return "Waiting for you";
    case "busy":
      return "Busy";
    case "broken":
      return thread.runtime?.lastErrorClass === "usage_limit" ? "Usage limit reached" : "Failed";
    case "done":
      return "Done";
    case "stale":
      return "No response";
  }
}

export const THREAD_ACTIVITY_DOT_CLASS: Record<ThreadActivityKind, string> = {
  waiting: "bg-info",
  busy: "bg-warning",
  broken: "bg-error",
  done: "bg-success",
  stale: "bg-muted-foreground/40",
};
