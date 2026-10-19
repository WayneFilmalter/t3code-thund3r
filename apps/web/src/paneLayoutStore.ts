/**
 * Zustand store for the chat area's split-pane layout.
 *
 * The layout is a binary tree of splits over leaf panes. Each leaf shows one
 * thread (or a draft, or nothing). Exactly one leaf is focused: the URL always
 * mirrors the focused pane's thread, so sidebar clicks, Cmd+N, and everything
 * else that navigates keeps working unchanged and lands in the focused pane.
 * While the tree is a single leaf the chat route renders its pre-pane layout
 * and this store is dormant; pane targets are re-seeded from the URL on split.
 * A split layout is saved to local storage and comes back on the next launch;
 * a lone pane saves nothing, so closing the panes also forgets them.
 * `maximized` shows only the focused pane; the tree underneath is untouched, so
 * toggling it off restores the exact split, and focus moves swap the big pane.
 */
import { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DraftId } from "./composerDraftStore";
import { resolveStorage } from "./lib/storage";
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

/** Moves the id counter past every restored id so new panes never reuse one. */
function reserveIds(node: PaneNode): void {
  const suffix = /-(\d+)$/.exec(node.id);
  if (suffix) paneIdCounter = Math.max(paneIdCounter, Number(suffix[1]));
  if (node.type === "split") {
    reserveIds(node.first);
    reserveIds(node.second);
  }
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
   * True from hydrating a saved split layout until PaneLayout's first sync,
   * which then puts the URL on the focused pane's thread. Never persisted.
   */
  pendingRestoreSync: boolean;
  consumeRestoreSync: () => boolean;
  /**
   * Splits the focused pane and focuses the new, empty half. The original
   * pane keeps `currentTarget` (the URL's target, which is what it shows);
   * the caller then starts a thread, and its navigation fills the new pane.
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
  /** Only the focused pane is shown while true; the split tree stays as it is. */
  maximized: boolean;
  /** Fills the chat area with the focused pane, or restores the split. No-op on a lone pane. */
  toggleMaximizedPane: () => void;
}

export function paneExists(node: PaneNode, paneId: PaneId): boolean {
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

export type PaneFocusDirection = "left" | "right" | "up" | "down";

export interface PaneRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The pane a directional move lands on, like moving between terminal splits:
 * among panes entirely on that side, prefer ones that line up with the
 * current pane, then the nearest, then the best aligned. Null at an edge.
 */
export function findPaneInDirection(
  rects: ReadonlyMap<PaneId, PaneRect>,
  fromId: PaneId,
  direction: PaneFocusDirection,
): PaneId | null {
  const from = rects.get(fromId);
  if (!from) return null;
  const horizontal = direction === "left" || direction === "right";
  const EDGE_TOLERANCE = 2;
  let best: { id: PaneId; aligned: boolean; distance: number; offset: number } | null = null;
  for (const [id, rect] of rects) {
    if (id === fromId) continue;
    const distance =
      direction === "left"
        ? from.left - rect.right
        : direction === "right"
          ? rect.left - from.right
          : direction === "up"
            ? from.top - rect.bottom
            : rect.top - from.bottom;
    if (distance < -EDGE_TOLERANCE) continue;
    const overlap = horizontal
      ? Math.min(from.bottom, rect.bottom) - Math.max(from.top, rect.top)
      : Math.min(from.right, rect.right) - Math.max(from.left, rect.left);
    const offset = horizontal
      ? Math.abs((from.top + from.bottom) / 2 - (rect.top + rect.bottom) / 2)
      : Math.abs((from.left + from.right) / 2 - (rect.left + rect.right) / 2);
    const candidate = { id, aligned: overlap > 0, distance: Math.max(0, distance), offset };
    if (
      best === null ||
      (candidate.aligned && !best.aligned) ||
      (candidate.aligned === best.aligned &&
        (candidate.distance < best.distance ||
          (candidate.distance === best.distance && candidate.offset < best.offset)))
    ) {
      best = candidate;
    }
  }
  return best?.id ?? null;
}

/**
 * Pane rects laid out from the tree's ratios on a `size` square, for directional
 * focus while a maximized pane hides the others (their DOM rects are all zero).
 * The large canvas keeps findPaneInDirection's pixel tolerance negligible.
 */
export function layoutPaneRects(root: PaneNode, size = 10_000): Map<PaneId, PaneRect> {
  const rects = new Map<PaneId, PaneRect>();
  const visit = (node: PaneNode, rect: PaneRect) => {
    if (node.type === "leaf") {
      rects.set(node.id, rect);
      return;
    }
    if (node.direction === "row") {
      const x = rect.left + (rect.right - rect.left) * node.ratio;
      visit(node.first, { ...rect, right: x });
      visit(node.second, { ...rect, left: x });
    } else {
      const y = rect.top + (rect.bottom - rect.top) * node.ratio;
      visit(node.first, { ...rect, bottom: y });
      visit(node.second, { ...rect, top: y });
    }
  };
  visit(root, { left: 0, top: 0, right: size, bottom: size });
  return rects;
}

type PaneLayoutState = Pick<
  PaneLayoutStore,
  "root" | "focusedPaneId" | "paneTargets" | "maximized"
>;

function createInitialState(): PaneLayoutState {
  const id = nextId("pane");
  return {
    root: { type: "leaf", id },
    focusedPaneId: id,
    paneTargets: {},
    maximized: false,
  };
}

const PANE_LAYOUT_STORAGE_KEY = "t3code:pane-layout:v1";
const PANE_LAYOUT_STORAGE_VERSION = 1;

const PersistedPaneNode: Schema.Codec<PaneNode> = Schema.Union([
  Schema.Struct({ type: Schema.Literal("leaf"), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("split"),
    id: Schema.String,
    direction: Schema.Literals(["row", "column"]),
    ratio: Schema.Number,
    first: Schema.suspend(() => PersistedPaneNode),
    second: Schema.suspend(() => PersistedPaneNode),
  }),
]);

const PersistedPaneTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("server"), threadRef: ScopedThreadRef }),
  Schema.Struct({ kind: Schema.Literal("draft"), draftId: DraftId }),
]);

const PersistedPaneLayout = Schema.Struct({
  root: PersistedPaneNode,
  focusedPaneId: Schema.String,
  paneTargets: Schema.Record(Schema.String, Schema.NullOr(PersistedPaneTarget)),
  maximized: Schema.optional(Schema.Boolean),
});

/** What the store writes: the layout while split, nothing once it is a lone pane. */
interface PersistedPaneLayoutStore {
  layout: typeof PersistedPaneLayout.Type | null;
}

const isPersistedPaneLayout = Schema.is(PersistedPaneLayout);

function withClampedRatios(node: PaneNode): PaneNode {
  if (node.type === "leaf") return node;
  return {
    ...node,
    ratio: clampPaneRatio(Number.isFinite(node.ratio) ? node.ratio : 0.5),
    first: withClampedRatios(node.first),
    second: withClampedRatios(node.second),
  };
}

function collectNodeIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.id];
  return [node.id, ...collectNodeIds(node.first), ...collectNodeIds(node.second)];
}

/**
 * Rebuilds a saved split layout, or returns null for anything that is not a
 * usable split: the store then starts as a single empty pane. Only leaves still
 * in the tree keep their targets; the focused pane falls back to the first leaf.
 */
export function restorePersistedPaneLayout(persisted: unknown): PaneLayoutState | null {
  const layout =
    persisted && typeof persisted === "object" && "layout" in persisted ? persisted.layout : null;
  if (!isPersistedPaneLayout(layout) || layout.root.type !== "split") return null;
  const root = withClampedRatios(layout.root);
  const ids = collectNodeIds(root);
  if (new Set(ids).size !== ids.length) return null;
  const leafIds = collectLeafIds(root);
  if (leafIds.length > MAX_PANES) return null;
  const paneTargets: Record<PaneId, ThreadRouteTarget | null> = {};
  for (const leafId of leafIds) {
    paneTargets[leafId] = layout.paneTargets[leafId] ?? null;
  }
  reserveIds(root);
  return {
    root,
    focusedPaneId: leafIds.includes(layout.focusedPaneId)
      ? layout.focusedPaneId
      : firstLeafId(root),
    paneTargets,
    maximized: layout.maximized === true,
  };
}

export const usePaneLayoutStore = create<PaneLayoutStore>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      pendingRestoreSync: false,

      consumeRestoreSync: () => {
        if (!get().pendingRestoreSync) return false;
        set({ pendingRestoreSync: false });
        return true;
      },

      splitFocusedPane: (direction, currentTarget) => {
        set((state) => {
          if (collectLeafIds(state.root).length >= MAX_PANES) return state;
          const newLeaf = { type: "leaf", id: nextId("pane") } as const;
          const root = splitLeafNode(state.root, state.focusedPaneId, direction, newLeaf);
          if (!root) return state;
          // The new pane should appear beside the old one, not alone.
          return {
            root,
            focusedPaneId: newLeaf.id,
            paneTargets: {
              ...state.paneTargets,
              [state.focusedPaneId]: currentTarget,
              [newLeaf.id]: null,
            },
            maximized: false,
          };
        });
      },

      closeFocusedPane: () => {
        set((state) => {
          const root = removeLeafNode(state.root, state.focusedPaneId);
          if (!root) return state;
          const paneTargets = { ...state.paneTargets };
          delete paneTargets[state.focusedPaneId];
          // Closing the big pane reveals what is left.
          return { root, focusedPaneId: firstLeafId(root), paneTargets, maximized: false };
        });
      },

      toggleMaximizedPane: () => {
        set((state) => (state.root.type === "leaf" ? state : { maximized: !state.maximized }));
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
    }),
    {
      name: PANE_LAYOUT_STORAGE_KEY,
      version: PANE_LAYOUT_STORAGE_VERSION,
      // Synchronous storage: the store hydrates inside create(), so the chat
      // route sees the split on its first render and never starts the index
      // route's fresh draft.
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state): PersistedPaneLayoutStore => ({
        layout:
          state.root.type === "split"
            ? {
                root: state.root,
                focusedPaneId: state.focusedPaneId,
                paneTargets: state.paneTargets,
                maximized: state.maximized,
              }
            : null,
      }),
      migrate: (): PersistedPaneLayoutStore => ({ layout: null }),
      merge: (persisted, current) => {
        const restored = restorePersistedPaneLayout(persisted);
        return {
          ...current,
          ...(restored ?? createInitialState()),
          pendingRestoreSync: restored !== null,
        };
      },
    },
  ),
);

/** Test-only: returns the layout to a single empty pane. */
export function resetPaneLayoutForTesting(): void {
  usePaneLayoutStore.setState({ ...createInitialState(), pendingRestoreSync: false });
}
