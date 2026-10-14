import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { assert, beforeEach, describe, it } from "vite-plus/test";

import {
  MAX_PANES,
  clampPaneRatio,
  findPaneInDirection,
  collectLeafIds,
  findPaneWithTarget,
  resetPaneLayoutForTesting,
  usePaneLayoutStore,
} from "./paneLayoutStore";
import type { ThreadRouteTarget } from "./threadRoutes";

function serverTarget(threadId: string): ThreadRouteTarget {
  return {
    kind: "server",
    threadRef: scopeThreadRef("env-1" as EnvironmentId, threadId as ThreadId),
  };
}

function state() {
  return usePaneLayoutStore.getState();
}

describe("paneLayoutStore", () => {
  beforeEach(() => {
    resetPaneLayoutForTesting();
  });

  it("starts as a single unfocused-agnostic leaf", () => {
    assert.strictEqual(state().root.type, "leaf");
    assert.deepEqual(collectLeafIds(state().root), [state().focusedPaneId]);
  });

  it("split keeps the current target in the original pane and focuses a new empty one", () => {
    const original = state().focusedPaneId;
    const target = serverTarget("thread-1");
    state().splitFocusedPane("row", target);

    const { root, focusedPaneId, paneTargets } = state();
    assert.strictEqual(root.type, "split");
    const leaves = collectLeafIds(root);
    assert.lengthOf(leaves, 2);
    assert.notStrictEqual(focusedPaneId, original);
    assert.include(leaves, focusedPaneId);
    assert.deepEqual(paneTargets[original], target);
    assert.isNull(paneTargets[focusedPaneId] ?? null);
  });

  it("splits down inside an existing right split, keeping the tree shape", () => {
    state().splitFocusedPane("row", null);
    state().splitFocusedPane("column", serverTarget("thread-2"));
    const root = state().root;
    assert.strictEqual(root.type, "split");
    if (root.type !== "split") return;
    assert.strictEqual(root.direction, "row");
    assert.strictEqual(root.second.type, "split");
    if (root.second.type !== "split") return;
    assert.strictEqual(root.second.direction, "column");
    assert.lengthOf(collectLeafIds(root), 3);
  });

  it("stops splitting at the pane limit", () => {
    for (let i = 0; i < MAX_PANES + 2; i += 1) {
      state().splitFocusedPane("row", null);
    }
    assert.lengthOf(collectLeafIds(state().root), MAX_PANES);
  });

  it("close promotes the sibling, focuses it, and drops the pane's target", () => {
    const original = state().focusedPaneId;
    state().splitFocusedPane("row", serverTarget("thread-1"));
    const added = state().focusedPaneId;
    state().closeFocusedPane();

    assert.strictEqual(state().root.type, "leaf");
    assert.strictEqual(state().focusedPaneId, original);
    assert.isUndefined(state().paneTargets[added]);
  });

  it("close on a lone pane is a no-op", () => {
    const before = state();
    state().closeFocusedPane();
    assert.strictEqual(state().root, before.root);
    assert.strictEqual(state().focusedPaneId, before.focusedPaneId);
  });

  it("focusPane ignores unknown panes", () => {
    state().splitFocusedPane("row", null);
    const focused = state().focusedPaneId;
    state().focusPane("pane-does-not-exist");
    assert.strictEqual(state().focusedPaneId, focused);
  });

  it("setPaneTarget retargets a pane and findPaneWithTarget locates it", () => {
    state().splitFocusedPane("row", serverTarget("thread-1"));
    const focused = state().focusedPaneId;
    const target = serverTarget("thread-2");
    state().setPaneTarget(focused, target);

    assert.deepEqual(state().paneTargets[focused], target);
    assert.strictEqual(findPaneWithTarget(state().root, state().paneTargets, target), focused);
    assert.isNull(findPaneWithTarget(state().root, state().paneTargets, serverTarget("thread-3")));
  });

  it("setPaneTarget with an equal target keeps the same state object", () => {
    const original = state().focusedPaneId;
    state().splitFocusedPane("row", serverTarget("thread-1"));
    const before = state().paneTargets;
    state().setPaneTarget(original, serverTarget("thread-1"));
    assert.strictEqual(state().paneTargets, before);
  });

  it("setSplitRatio clamps and targets one split", () => {
    state().splitFocusedPane("row", null);
    const root = state().root;
    assert.strictEqual(root.type, "split");
    if (root.type !== "split") return;
    state().setSplitRatio(root.id, 0.99);
    const updated = state().root;
    assert.strictEqual(updated.type, "split");
    if (updated.type !== "split") return;
    assert.strictEqual(updated.ratio, clampPaneRatio(0.99));
    assert.isBelow(updated.ratio, 1);
  });
});

describe("findPaneInDirection", () => {
  // Layout: a | b on top of a full-width c.
  //   a: left half of the top row, b: right half, c: bottom row.
  const rects = new Map([
    ["a", { left: 0, top: 0, right: 500, bottom: 400 }],
    ["b", { left: 501, top: 0, right: 1000, bottom: 400 }],
    ["c", { left: 0, top: 401, right: 1000, bottom: 800 }],
  ]);

  it("moves to the side neighbor that lines up", () => {
    assert.strictEqual(findPaneInDirection(rects, "a", "right"), "b");
    assert.strictEqual(findPaneInDirection(rects, "b", "left"), "a");
  });

  it("moves down into a wide pane and back up to the closest-aligned pane", () => {
    assert.strictEqual(findPaneInDirection(rects, "b", "down"), "c");
    assert.strictEqual(findPaneInDirection(rects, "c", "up"), "a");
  });

  it("stays put at an edge", () => {
    assert.isNull(findPaneInDirection(rects, "a", "left"));
    assert.isNull(findPaneInDirection(rects, "a", "up"));
    assert.isNull(findPaneInDirection(rects, "c", "down"));
  });

  it("prefers an aligned pane over a nearer diagonal one", () => {
    const stacked = new Map([
      ["left", { left: 0, top: 0, right: 400, bottom: 800 }],
      ["topRight", { left: 401, top: 0, right: 800, bottom: 300 }],
      ["farBottomRight", { left: 900, top: 500, right: 1200, bottom: 800 }],
    ]);
    assert.strictEqual(findPaneInDirection(stacked, "topRight", "left"), "left");
  });
});
