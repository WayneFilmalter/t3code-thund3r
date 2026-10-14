/**
 * Renders the chat area as split panes once the pane layout holds more than
 * one leaf. Each leaf is an independent ThreadRouteView; exactly one leaf is
 * focused and the URL mirrors that pane's thread, so every existing
 * navigation path (sidebar clicks, Cmd+N, the command palette) lands in the
 * focused pane without knowing panes exist. Clicking into a pane focuses it.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { ThreadRouteView } from "./ThreadRouteView";
import { SidebarInset } from "./ui/sidebar";
import { shortcutLabelForCommand } from "../keybindings";
import { navigateToPaneTarget } from "../paneLayoutActions";
import {
  findPaneWithTarget,
  usePaneLayoutStore,
  type PaneId,
  type PaneNode,
} from "../paneLayoutStore";
import { PaneFocusContext, type PaneFocusHandle } from "../paneFocus";
import { threadRouteTargetsEqual, type ThreadRouteTarget } from "../threadRoutes";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";

type SplitNode = Extract<PaneNode, { type: "split" }>;

export function PaneLayout({ threadTarget }: { threadTarget: ThreadRouteTarget | null }) {
  const root = usePaneLayoutStore((state) => state.root);
  const focusedPaneId = usePaneLayoutStore((state) => state.focusedPaneId);
  const focusedTarget = usePaneLayoutStore(
    (state) => state.paneTargets[state.focusedPaneId] ?? null,
  );
  const navigate = useNavigate();

  // Keeps the URL and the focused pane pointing at the same thread. A focus
  // change moves the URL to the pane; a URL change (any navigation) retargets
  // the focused pane — unless another pane already shows that thread, in
  // which case focus moves there instead of opening a duplicate view.
  const prevRef = useRef<{ threadTarget: ThreadRouteTarget | null; focusedPaneId: PaneId | null }>({
    threadTarget,
    focusedPaneId,
  });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { threadTarget, focusedPaneId };
    if (threadRouteTargetsEqual(threadTarget, focusedTarget)) return;
    if (focusedPaneId !== prev.focusedPaneId) {
      navigateToPaneTarget(navigate, focusedTarget);
      return;
    }
    const store = usePaneLayoutStore.getState();
    if (threadTarget !== null) {
      const holder = findPaneWithTarget(store.root, store.paneTargets, threadTarget);
      if (holder !== null && holder !== focusedPaneId) {
        store.focusPane(holder);
        return;
      }
    }
    store.setPaneTarget(focusedPaneId, threadTarget);
  }, [threadTarget, focusedPaneId, focusedTarget, navigate]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
      <PaneTree node={root} />
    </SidebarInset>
  );
}

function PaneTree({ node }: { node: PaneNode }) {
  if (node.type === "leaf") {
    return <PaneLeaf paneId={node.id} />;
  }
  return <PaneSplit node={node} />;
}

function PaneSplit({ node }: { node: SplitNode }) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        node.direction === "row" ? "flex-row" : "flex-col",
      )}
    >
      <div className="flex min-h-0 min-w-0 basis-0" style={{ flexGrow: node.ratio }}>
        <PaneTree node={node.first} />
      </div>
      <PaneDivider split={node} />
      <div className="flex min-h-0 min-w-0 basis-0" style={{ flexGrow: 1 - node.ratio }}>
        <PaneTree node={node.second} />
      </div>
    </div>
  );
}

function PaneDivider({ split }: { split: SplitNode }) {
  const horizontal = split.direction === "row";
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number; parent: HTMLElement } | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      className={cn(
        "relative z-10 shrink-0 bg-border",
        horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const parent = event.currentTarget.parentElement;
        if (!parent) return;
        pendingRef.current = { x: event.clientX, y: event.clientY, parent };
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const pending = pendingRef.current;
          if (!pending) return;
          const rect = pending.parent.getBoundingClientRect();
          const ratio = horizontal
            ? (pending.x - rect.left) / Math.max(1, rect.width)
            : (pending.y - rect.top) / Math.max(1, rect.height);
          usePaneLayoutStore.getState().setSplitRatio(split.id, ratio);
        });
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      {/* Wider invisible hit area; the visible divider stays one pixel. */}
      <div
        className={cn("absolute", horizontal ? "-inset-x-1 inset-y-0" : "inset-x-0 -inset-y-1")}
      />
    </div>
  );
}

function PaneLeaf({ paneId }: { paneId: PaneId }) {
  const focused = usePaneLayoutStore((state) => state.focusedPaneId === paneId);
  const target = usePaneLayoutStore((state) => state.paneTargets[paneId] ?? null);
  const navigate = useNavigate();

  const focusHandle = useMemo<PaneFocusHandle>(
    () => ({
      isFocused: () => usePaneLayoutStore.getState().focusedPaneId === paneId,
      subscribe: (listener) =>
        usePaneLayoutStore.subscribe((state, previous) => {
          if (state.focusedPaneId !== previous.focusedPaneId) listener();
        }),
    }),
    [paneId],
  );

  // In an unfocused pane, a view-initiated route change (draft promotion, a
  // deleted thread's redirect) retargets this pane instead of the URL.
  const navigateToTarget = useCallback(
    (next: ThreadRouteTarget | null, options?: { replace?: boolean }) => {
      const store = usePaneLayoutStore.getState();
      if (store.focusedPaneId === paneId) {
        navigateToPaneTarget(navigate, next, options);
      } else {
        store.setPaneTarget(paneId, next);
      }
    },
    [navigate, paneId],
  );

  const focusThisPane = useCallback(() => {
    usePaneLayoutStore.getState().focusPane(paneId);
  }, [paneId]);

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        focused && "ring-1 ring-primary/35 ring-inset",
      )}
      data-pane-focused={focused || undefined}
      onPointerDownCapture={focusThisPane}
      onFocusCapture={focusThisPane}
    >
      <PaneFocusContext value={focusHandle}>
        {target !== null ? (
          <ThreadRouteView target={target} inset={false} navigateToTarget={navigateToTarget} />
        ) : (
          <EmptyPanePlaceholder />
        )}
      </PaneFocusContext>
    </div>
  );
}

function EmptyPanePlaceholder() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const newThreadShortcut = shortcutLabelForCommand(keybindings, "chat.new");
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="text-muted-foreground max-w-xs text-center text-sm">
        {newThreadShortcut
          ? `Press ${newThreadShortcut} to start a thread here, or pick one from the sidebar.`
          : "Pick a thread from the sidebar to show it here."}
      </p>
    </div>
  );
}
