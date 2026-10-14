import type {
  LinearIssue,
  LinearIssuePriority,
  PullRequestListEntry,
  PullRequestState,
  VcsRef,
} from "@t3tools/contracts";

export const PRIORITY_LABELS: Record<LinearIssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

/** Linear estimates are points on the team's scale; one point reads as singular. */
export function estimateLabel(estimate: number | null): string | null {
  if (estimate === null) return null;
  return estimate === 1 ? "1 pt" : `${estimate} pts`;
}

export type LinearSectionState = "idle" | "loading" | "error" | "empty" | "ready";

/**
 * What a section shows under its header. A refresh with results already in
 * hand keeps the list visible, so loading and error only win before the
 * first result lands.
 */
export function sectionState(view: {
  readonly armed: boolean;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly issues: ReadonlyArray<LinearIssue> | null;
}): LinearSectionState {
  if (!view.armed) return "idle";
  if (view.issues === null) {
    if (view.isPending) return "loading";
    if (view.error !== null) return "error";
    return "loading";
  }
  return view.issues.length === 0 ? "empty" : "ready";
}

export type LinearGitPresence = "none" | "branch" | "open" | "merged" | "closed";

export interface LinearGitIndex {
  /** Lower-cased branch names present locally or on a remote, without the remote prefix. */
  readonly branches: ReadonlySet<string>;
  /** Lower-cased head branch to the strongest pull request state seen for it. */
  readonly pullRequests: ReadonlyMap<string, PullRequestState>;
}

export const EMPTY_LINEAR_GIT_INDEX: LinearGitIndex = {
  branches: new Set(),
  pullRequests: new Map(),
};

const PR_STATE_STRENGTH: Record<PullRequestState, number> = { merged: 2, open: 1, closed: 0 };

/**
 * What git knows about each Linear branch, from one listing of the project's refs and its
 * pull requests. A merged pull request outranks an open one, which outranks a closed one, so a
 * branch reopened after a bad merge still reads as merged until the new request lands.
 */
export function buildLinearGitIndex(
  refs: ReadonlyArray<Pick<VcsRef, "name" | "isRemote" | "remoteName">>,
  pullRequests: ReadonlyArray<Pick<PullRequestListEntry, "headBranch" | "state">>,
): LinearGitIndex {
  const branches = new Set<string>();
  for (const ref of refs) {
    const prefix = ref.isRemote && ref.remoteName ? `${ref.remoteName}/` : "";
    const name = ref.name.startsWith(prefix) ? ref.name.slice(prefix.length) : ref.name;
    branches.add(name.toLowerCase());
  }
  const byHead = new Map<string, PullRequestState>();
  for (const pullRequest of pullRequests) {
    const key = pullRequest.headBranch.toLowerCase();
    const current = byHead.get(key);
    if (
      current === undefined ||
      PR_STATE_STRENGTH[pullRequest.state] > PR_STATE_STRENGTH[current]
    ) {
      byHead.set(key, pullRequest.state);
    }
  }
  return { branches, pullRequests: byHead };
}

export function resolveLinearGitPresence(
  branchName: string | null,
  index: LinearGitIndex,
): LinearGitPresence {
  if (branchName === null) return "none";
  const key = branchName.toLowerCase();
  return index.pullRequests.get(key) ?? (index.branches.has(key) ? "branch" : "none");
}
