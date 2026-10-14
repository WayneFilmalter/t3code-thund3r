/**
 * Zustand store for the chat area's split-pane layout.
 *
 * The layout is a binary tree of splits over leaf panes. Each leaf shows one
 * thread (or a draft, or nothing). Exactly one leaf is focused: the URL always
 * mirrors the focused pane's thread, so sidebar clicks, Cmd+N, and everything
 * else that navigates keeps working unchanged and lands in the focused pane.
 * While the tree is a single leaf the chat route renders its pre-pane layout
 * and this store is dormant; pane targets are re-seeded from the URL on split.
 */
import { create } from "zustand";
import { threadRouteTargetsEqual, type ThreadRouteTarget } from "./threadRoutes";

export type PaneId = string;
export type PaneSplitDirection = "row" | "column";

export type PaneNode =
  | { readonly type: "leaf"; readonly id: PaneId }
  | {
      readonly type: "split";
      readonly id: string;
      readonly direction: PaneSplitDirection;
      /** Fraction of the split's main axis given to `first`, clamped to [0.15, 0.85]. */
      readonly ratio: number;
      readonly first: PaneNode;
      readonly second: PaneNode;
    };

export const MAX_PANES = 8;
export const MIN_PANE_RATIO = 0.15;

let paneIdCounter = 0;
function nextId(prefix: string): string {
  paneIdCounter += 1;
  return `${prefix}-${paneIdCounter}`;
}

export function clampPaneRatio(ratio: number): number {
  return Math.min(1 - MIN_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio));
}

export function collectLeafIds(node: PaneNode): PaneId[] {
  if (node.type === "leaf") return [node.id];
  return [...collectLeafIds(node.first), ...collectLeafIds(node.second)];
}

export function firstLeafId(node: PaneNode): PaneId {
  return node.type === "leaf" ? node.id : firstLeafId(node.first);
}

function splitLeafNode(
  node: PaneNode,
  leafId: PaneId,
  direction: PaneSplitDirection,
  newLeaf: Extract<PaneNode, { type: "leaf" }>,
): PaneNode | null {
  if (node.type === "leaf") {
    if (node.id !== leafId) return null;
    return {
      type: "split",
      id: nextId("split"),
      direction,
      ratio: 0.5,
      first: node,
      second: newLeaf,
    };
  }
  const first = splitLeafNode(node.first, leafId, direction, newLeaf);
  if (first) return { ...node, first };
  const second = splitLeafNode(node.second, leafId, direction, newLeaf);
  if (second) return { ...node, second };
  return null;
}

/** Removes a leaf, promoting its sibling. Null when the leaf is absent or the root itself. */
function removeLeafNode(node: PaneNode, leafId: PaneId): PaneNode | null {
  if (node.type === "leaf") return null;
  if (node.first.type === "leaf" && node.first.id === leafId) return node.second;
  if (node.second.type === "leaf" && node.second.id === leafId) return node.first;
  const first = removeLeafNode(node.first, leafId);
  if (first) return { ...node, first };
  const second = removeLeafNode(node.second, leafId);
  if (second) return { ...node, second };
  return null;
}

function withSplitRatio(node: PaneNode, splitId: string, ratio: number): PaneNode | null {
  if (node.type === "leaf") return null;
  if (node.id === splitId) return { ...node, ratio: clampPaneRatio(ratio) };
  const first = withSplitRatio(node.first, splitId, ratio);
  if (first) return { ...node, first };
  const second = withSplitRatio(node.second, splitId, ratio);
  if (second) return { ...node, second };
  return null;
}

export type PaneTargets = Readonly<Record<PaneId, ThreadRouteTarget | null>>;

export interface PaneLayoutStore {
  root: PaneNode;
  focusedPaneId: PaneId;
  paneTargets: PaneTargets;
  /**
   * Splits the focused pane, duplicating `currentTarget` (the URL's target,
   * which is what the focused pane shows) into both halves, and focuses the
   * new pane. Duplicating keeps the URL and the focused pane in agreement
   * without a navigation, so there is no transition state to reconcile.
   */
  splitFocusedPane: (
    direction: PaneSplitDirection,
    currentTarget: ThreadRouteTarget | null,
  ) => void;
  /** Closes the focused pane and focuses its promoted neighbor. No-op on a lone pane. */
  closeFocusedPane: () => void;
  focusPane: (paneId: PaneId) => void;
  setPaneTarget: (paneId: PaneId, target: ThreadRouteTarget | null) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
}

function paneExists(node: PaneNode, paneId: PaneId): boolean {
  if (node.type === "leaf") return node.id === paneId;
  return paneExists(node.first, paneId) || paneExists(node.second, paneId);
}

/** The leaf already showing `target`, if any. Used to focus instead of duplicating. */
export function findPaneWithTarget(
  root: PaneNode,
  paneTargets: PaneTargets,
  target: ThreadRouteTarget,
): PaneId | null {
  for (const leafId of collectLeafIds(root)) {
    if (threadRouteTargetsEqual(paneTargets[leafId] ?? null, target)) return leafId;
  }
  return null;
}

function createInitialState(): Pick<PaneLayoutStore, "root" | "focusedPaneId" | "paneTargets"> {
  const id = nextId("pane");
  return {
    root: { type: "leaf", id },
    focusedPaneId: id,
    paneTargets: {},
  };
}

export const usePaneLayoutStore = create<PaneLayoutStore>((set) => ({
  ...createInitialState(),

  splitFocusedPane: (direction, currentTarget) => {
    set((state) => {
      if (collectLeafIds(state.root).length >= MAX_PANES) return state;
      const newLeaf = { type: "leaf", id: nextId("pane") } as const;
      const root = splitLeafNode(state.root, state.focusedPaneId, direction, newLeaf);
      if (!root) return state;
      return {
        root,
        focusedPaneId: newLeaf.id,
        paneTargets: {
          ...state.paneTargets,
          [state.focusedPaneId]: currentTarget,
          [newLeaf.id]: currentTarget,
        },
      };
    });
  },

  closeFocusedPane: () => {
    set((state) => {
      const root = removeLeafNode(state.root, state.focusedPaneId);
      if (!root) return state;
      const paneTargets = { ...state.paneTargets };
      delete paneTargets[state.focusedPaneId];
      return { root, focusedPaneId: firstLeafId(root), paneTargets };
    });
  },

  focusPane: (paneId) => {
    set((state) => {
      if (state.focusedPaneId === paneId || !paneExists(state.root, paneId)) return state;
      return { focusedPaneId: paneId };
    });
  },

  setPaneTarget: (paneId, target) => {
    set((state) => {
      if (!paneExists(state.root, paneId)) return state;
      if (threadRouteTargetsEqual(state.paneTargets[paneId] ?? null, target)) return state;
      return { paneTargets: { ...state.paneTargets, [paneId]: target } };
    });
  },

  setSplitRatio: (splitId, ratio) => {
    set((state) => {
      const root = withSplitRatio(state.root, splitId, ratio);
      return root ? { root } : state;
    });
  },
}));

/** Test-only: returns the layout to a single empty pane. */
export function resetPaneLayoutForTesting(): void {
  usePaneLayoutStore.setState(createInitialState());
}
