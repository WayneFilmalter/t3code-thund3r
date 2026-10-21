/**
 * Renders the chat area as split panes once the pane layout holds more than
 * one leaf. Each leaf is an independent ThreadRouteView; exactly one leaf is
 * focused and the URL mirrors that pane's thread, so every existing
 * navigation path (sidebar clicks, Cmd+N, the command palette) lands in the
 * focused pane without knowing panes exist. Clicking into a pane focuses it.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ThreadRouteView } from "./ThreadRouteView";
import { SidebarInset } from "./ui/sidebar";
import type { KeybindingCommand } from "@t3tools/contracts";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { usePreviewPanelInlineSize } from "../hooks/usePreviewPanelInlineSize";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { movePaneFocus, navigateToPaneTarget, resolvePaneUrlSync } from "../paneLayoutActions";
import {
  paneExists,
  usePaneLayoutStore,
  type PaneFocusDirection,
  type PaneId,
  type PaneNode,
} from "../paneLayoutStore";
import {
  PaneFocusContext,
  PanePanelPortalContext,
  type PaneFocusHandle,
  type PanePanelPortal,
} from "../paneFocus";
import type { ThreadRouteTarget } from "../threadRoutes";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";

type SplitNode = Extract<PaneNode, { type: "split" }>;

export function PaneLayout({ threadTarget }: { threadTarget: ThreadRouteTarget | null }) {
  const root = usePaneLayoutStore((state) => state.root);
  const focusedPaneId = usePaneLayoutStore((state) => state.focusedPaneId);
  const maximized = usePaneLayoutStore((state) => state.maximized);
  const navigate = useNavigate();
  const [panelRow, setPanelRow] = useState<HTMLDivElement | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  // One width for the one panel: a view sizing it from its own state would let
  // panes drift apart, e.g. a width measured while that pane was hidden.
  const inlineSize = usePreviewPanelInlineSize(undefined, { container: panelRow });
  const panelPortal = useMemo<PanePanelPortal>(
    () => ({ host: panelHost, row: panelRow, inlineSize }),
    [inlineSize, panelHost, panelRow],
  );

  // Keeps the URL and the focused pane pointing at the same thread; see
  // resolvePaneUrlSync for the rules. The first sync after a restored layout
  // has no previous state: the saved panes, not the launch URL, are the truth.
  const prevRef = useRef({ threadTarget, focusedPaneId });
  useEffect(() => {
    const store = usePaneLayoutStore.getState();
    const previous = store.consumeRestoreSync() ? null : prevRef.current;
    prevRef.current = { threadTarget, focusedPaneId };
    const sync = resolvePaneUrlSync({
      previous,
      threadTarget,
      focusedPaneId,
      root: store.root,
      paneTargets: store.paneTargets,
    });
    if (sync.kind === "navigate") {
      navigateToPaneTarget(navigate, sync.target, { replace: sync.replace ?? false });
    } else if (sync.kind === "focus") store.focusPane(sync.paneId);
    else if (sync.kind === "retarget") store.setPaneTarget(focusedPaneId, sync.target);
  }, [threadTarget, focusedPaneId, navigate]);

  usePaneFocusShortcuts();

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
      {/* One right panel for the whole split area: the focused pane's view
          portals its panel into the host beside the tree. */}
      <div ref={setPanelRow} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <PanePanelPortalContext value={panelPortal}>
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <PaneTree node={root} maximizedPaneId={maximized ? focusedPaneId : null} />
          </div>
        </PanePanelPortalContext>
        <div ref={setPanelHost} className="relative flex min-h-0 shrink-0" />
      </div>
    </SidebarInset>
  );
}

const PANE_FOCUS_DIRECTIONS: Partial<Record<KeybindingCommand, PaneFocusDirection>> = {
  "pane.focusLeft": "left",
  "pane.focusRight": "right",
  "pane.focusUp": "up",
  "pane.focusDown": "down",
};

/**
 * Moves focus to the neighboring pane and toggles the maximized pane. Listens
 * in the capture phase so the composer and terminals cannot claim the chord
 * first; mounted only while split, so outside split panes the keys keep their
 * native behavior. A focused desktop browser page forwards the maximize chord
 * as a menu action instead.
 */
function usePaneFocusShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
          paneSplit: true,
        },
      });
      if (command === "pane.toggleMaximized") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) usePaneLayoutStore.getState().toggleMaximizedPane();
        return;
      }
      const direction = command ? PANE_FOCUS_DIRECTIONS[command] : undefined;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      movePaneFocus(direction);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);
  useEffect(() => {
    return window.desktopBridge?.onMenuAction((action) => {
      if (action === "pane.toggleMaximized") usePaneLayoutStore.getState().toggleMaximizedPane();
    });
  }, []);
}

function PaneTree({ node, maximizedPaneId }: { node: PaneNode; maximizedPaneId: PaneId | null }) {
  if (node.type === "leaf") {
    return <PaneLeaf paneId={node.id} maximized={node.id === maximizedPaneId} />;
  }
  return <PaneSplit node={node} maximizedPaneId={maximizedPaneId} />;
}

/**
 * While a pane is maximized, the half that does not hold it is hidden with
 * display:none rather than unmounted, so its views keep their state and the
 * split's ratio is untouched for when the layout comes back.
 */
function PaneSplit({ node, maximizedPaneId }: { node: SplitNode; maximizedPaneId: PaneId | null }) {
  const maximizedSide =
    maximizedPaneId === null
      ? null
      : paneExists(node.first, maximizedPaneId)
        ? "first"
        : paneExists(node.second, maximizedPaneId)
          ? "second"
          : null;
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        node.direction === "row" ? "flex-row" : "flex-col",
      )}
    >
      <div
        className={cn(maximizedSide === "second" ? "hidden" : "flex", "min-h-0 min-w-0 basis-0")}
        style={{ flexGrow: maximizedSide === null ? node.ratio : 1 }}
      >
        <PaneTree node={node.first} maximizedPaneId={maximizedPaneId} />
      </div>
      {maximizedSide === null ? <PaneDivider split={node} /> : null}
      <div
        className={cn(maximizedSide === "first" ? "hidden" : "flex", "min-h-0 min-w-0 basis-0")}
        style={{ flexGrow: maximizedSide === null ? 1 - node.ratio : 1 }}
      >
        <PaneTree node={node.second} maximizedPaneId={maximizedPaneId} />
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

function PaneLeaf({ paneId, maximized }: { paneId: PaneId; maximized: boolean }) {
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
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
      data-pane-id={paneId}
      data-pane-focused={focused || undefined}
      tabIndex={-1}
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
      {/* Drawn over the view, not as an inset ring: the view's own
          background would paint over a box-shadow on this element. A
          maximized pane is the only one visible, so it needs no ring. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-30 rounded-xs border border-primary/40 transition-opacity duration-150",
          focused && !maximized ? "opacity-100" : "opacity-0",
        )}
      />
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
