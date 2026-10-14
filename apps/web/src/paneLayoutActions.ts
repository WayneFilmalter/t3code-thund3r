/**
 * Pane commands shared by the chat route's shortcut handler and the command
 * palette. Navigation stays here, next to the store ops that need it: the URL
 * must always mirror the focused pane, and when a close collapses the layout
 * back to a single pane, PaneLayout unmounts before its own sync effect can
 * run, so the caller-side navigation is the one that holds.
 */
import type { useNavigate } from "@tanstack/react-router";

import { usePaneLayoutStore, type PaneSplitDirection } from "./paneLayoutStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
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

export function splitFocusedPane(
  direction: PaneSplitDirection,
  currentTarget: ThreadRouteTarget | null,
): void {
  usePaneLayoutStore.getState().splitFocusedPane(direction, currentTarget);
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
