/**
 * Pane commands shared by the chat route's shortcut handler and the command
 * palette. Navigation stays here, next to the store ops that need it: the URL
 * must always mirror the focused pane, and when a close collapses the layout
 * back to a single pane, PaneLayout unmounts before its own sync effect can
 * run, so the caller-side navigation is the one that holds.
 */
import type { useNavigate } from "@tanstack/react-router";

import {
  findPaneInDirection,
  findPaneWithTarget,
  usePaneLayoutStore,
  type PaneFocusDirection,
  type PaneId,
  type PaneNode,
  type PaneRect,
  type PaneSplitDirection,
  type PaneTargets,
} from "./paneLayoutStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  threadRouteTargetsEqual,
  type ThreadRouteTarget,
} from "./threadRoutes";

export type PaneNavigate = ReturnType<typeof useNavigate>;

export function navigateToPaneTarget(
  navigate: PaneNavigate,
  target: ThreadRouteTarget | null,
  options?: { replace?: boolean },
): void {
  const replace = options?.replace ?? false;
  if (target === null) {
    void navigate({ to: "/", replace });
    return;
  }
  if (target.kind === "server") {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target.threadRef),
      replace,
    });
    return;
  }
  void navigate({
    to: "/draft/$draftId",
    params: buildDraftThreadRouteParams(target.draftId),
    replace,
  });
}

/**
 * Splits the focused pane and starts a new thread, in the same project, in the new
 * half. The new thread's navigation lands in the newly focused pane like any other.
 * `startNewThread` gets the drafts open in any pane so it mints a fresh one: reusing
 * the project's empty draft would land on the pane that already shows it.
 */
export function splitFocusedPane(
  direction: PaneSplitDirection,
  currentTarget: ThreadRouteTarget | null,
  startNewThread: (openDraftIds: ReadonlySet<string>) => Promise<unknown>,
): void {
  const before = usePaneLayoutStore.getState().focusedPaneId;
  usePaneLayoutStore.getState().splitFocusedPane(direction, currentTarget);
  const after = usePaneLayoutStore.getState();
  if (after.focusedPaneId === before) return;
  void startNewThread(openPaneDraftIds(after.paneTargets));
}

/** Draft ids shown in any pane. */
export function openPaneDraftIds(paneTargets: PaneTargets): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const target of Object.values(paneTargets)) {
    if (target?.kind === "draft") ids.add(target.draftId);
  }
  return ids;
}

/**
 * Focuses the pane on `direction`'s side of the focused one, measured from
 * the rendered panes, and moves keyboard focus into its composer so typing
 * follows. Returns false at an edge.
 */
export function movePaneFocus(direction: PaneFocusDirection, root: ParentNode = document): boolean {
  const rects = new Map<PaneId, PaneRect>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const paneId = element.dataset.paneId;
    if (paneId) rects.set(paneId, element.getBoundingClientRect());
  }
  const store = usePaneLayoutStore.getState();
  const nextPaneId = findPaneInDirection(rects, store.focusedPaneId, direction);
  if (nextPaneId === null) return false;
  store.focusPane(nextPaneId);
  const paneElement = root.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(nextPaneId)}"]`);
  const composer = paneElement?.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  (composer ?? paneElement)?.focus({ preventScroll: true });
  return true;
}

export type PaneUrlSync =
  | { readonly kind: "none" }
  | {
      readonly kind: "navigate";
      readonly target: ThreadRouteTarget | null;
      readonly replace?: boolean;
    }
  | { readonly kind: "focus"; readonly paneId: PaneId }
  | { readonly kind: "retarget"; readonly target: ThreadRouteTarget | null };

/**
 * Decides how to keep the URL and the focused pane on the same thread after
 * either one moves. A focus change moves the URL to the pane's thread. A URL change
 * (any navigation) retargets the focused pane, or focuses the pane that
 * already shows that thread. An empty focused pane also adopts a URL thread
 * no pane shows, which covers a new thread whose navigation finished before
 * the split layout mounted.
 *
 * `previous: null` is the first sync after a saved layout was restored. The
 * desktop app relaunches on "/", so the URL follows the focused pane then;
 * a URL that still names a thread (a web reload, a deep link) wins instead.
 */
export function resolvePaneUrlSync(input: {
  readonly previous: {
    readonly threadTarget: ThreadRouteTarget | null;
    readonly focusedPaneId: PaneId;
  } | null;
  readonly threadTarget: ThreadRouteTarget | null;
  readonly focusedPaneId: PaneId;
  readonly root: PaneNode;
  readonly paneTargets: PaneTargets;
}): PaneUrlSync {
  const { previous, threadTarget, focusedPaneId, root, paneTargets } = input;
  const focusedTarget = paneTargets[focusedPaneId] ?? null;
  if (threadRouteTargetsEqual(threadTarget, focusedTarget)) return { kind: "none" };
  if (previous === null) {
    if (threadTarget === null) {
      return { kind: "navigate", target: focusedTarget, replace: true };
    }
    const holder = findPaneWithTarget(root, paneTargets, threadTarget);
    if (holder !== null && holder !== focusedPaneId) return { kind: "focus", paneId: holder };
    return { kind: "retarget", target: threadTarget };
  }
  // Focusing an empty pane leaves the URL alone: navigating away would race a
  // new thread that is about to land there.
  if (focusedPaneId !== previous.focusedPaneId && focusedTarget !== null) {
    return { kind: "navigate", target: focusedTarget };
  }
  const holder = threadTarget === null ? null : findPaneWithTarget(root, paneTargets, threadTarget);
  if (!threadRouteTargetsEqual(threadTarget, previous.threadTarget)) {
    if (holder !== null && holder !== focusedPaneId) return { kind: "focus", paneId: holder };
    return { kind: "retarget", target: threadTarget };
  }
  if (focusedTarget === null && threadTarget !== null && holder === null) {
    return { kind: "retarget", target: threadTarget };
  }
  return { kind: "none" };
}

export function closeFocusedPane(navigate: PaneNavigate): void {
  const store = usePaneLayoutStore.getState();
  if (store.root.type === "leaf") return;
  store.closeFocusedPane();
  const after = usePaneLayoutStore.getState();
  if (after.root.type === "leaf") {
    // Collapsed back to the pre-pane layout; its view follows the URL, so
    // point the URL at the surviving pane's thread.
    navigateToPaneTarget(navigate, after.paneTargets[after.focusedPaneId] ?? null);
  }
}
