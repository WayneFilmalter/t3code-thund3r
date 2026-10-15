import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { assert, beforeEach, describe, it } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import {
  MAX_PANES,
  clampPaneRatio,
  findPaneInDirection,
  collectLeafIds,
  findPaneWithTarget,
  resetPaneLayoutForTesting,
  restorePersistedPaneLayout,
  usePaneLayoutStore,
  type PaneNode,
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

function leaf(id: string): PaneNode {
  return { type: "leaf", id };
}

function split(id: string, first: PaneNode, second: PaneNode, ratio = 0.5): PaneNode {
  return { type: "split", id, direction: "row", ratio, first, second };
}

describe("restorePersistedPaneLayout", () => {
  const savedLayout = {
    root: split("split-3", leaf("pane-7"), leaf("pane-9"), 0.3),
    focusedPaneId: "pane-9",
    paneTargets: {
      "pane-7": serverTarget("thread-1"),
      "pane-9": { kind: "draft", draftId: DraftId.make("draft-1") },
    } satisfies Record<string, ThreadRouteTarget>,
  };

  it("restores a saved split with its targets and focus", () => {
    const restored = restorePersistedPaneLayout({ layout: savedLayout });
    assert.deepEqual(restored, savedLayout);
  });

  it.each([
    null,
    "layout",
    { layout: null },
    { layout: { root: leaf("pane-1"), focusedPaneId: "pane-1", paneTargets: {} } },
    { layout: { root: split("s", leaf("a"), leaf("a")), focusedPaneId: "a", paneTargets: {} } },
    {
      layout: {
        root: split("s", leaf("a"), leaf("b")),
        focusedPaneId: "a",
        paneTargets: { a: { kind: "server", threadRef: { environmentId: "env" } } },
      },
    },
  ])("rejects %j", (persisted) => {
    assert.isNull(restorePersistedPaneLayout(persisted));
  });

  it("rejects a layout with more leaves than the pane limit", () => {
    let root: PaneNode = leaf("pane-0");
    for (let i = 1; i <= MAX_PANES; i += 1) root = split(`split-${i}`, root, leaf(`pane-${i}`));
    assert.isNull(
      restorePersistedPaneLayout({ layout: { root, focusedPaneId: "pane-0", paneTargets: {} } }),
    );
  });

  it("falls back to the first leaf when the focused pane is gone and drops stray targets", () => {
    const restored = restorePersistedPaneLayout({
      layout: {
        root: split("split-1", leaf("pane-1"), leaf("pane-2"), 0.99),
        focusedPaneId: "pane-404",
        paneTargets: { "pane-1": serverTarget("thread-1"), "pane-404": serverTarget("thread-2") },
      },
    });
    assert.isNotNull(restored);
    assert.strictEqual(restored?.focusedPaneId, "pane-1");
    assert.deepEqual(restored?.paneTargets, { "pane-1": serverTarget("thread-1"), "pane-2": null });
    assert.strictEqual(
      restored?.root.type === "split" ? restored.root.ratio : null,
      clampPaneRatio(0.99),
    );
  });

  it("never mints an id that a restored pane already uses", async () => {
    await rehydrateWith({ layout: savedLayout });
    const before = new Set(collectLeafIds(state().root));
    state().splitFocusedPane("row", null);
    assert.isFalse(before.has(state().focusedPaneId));
    assert.lengthOf(new Set(collectLeafIds(state().root)), 3);
  });
});

async function rehydrateWith(persisted: unknown): Promise<void> {
  const { storage, name, version } = usePaneLayoutStore.persist.getOptions();
  await storage!.setItem(name!, { state: persisted as never, version: version ?? 0 });
  await usePaneLayoutStore.persist.rehydrate();
}

describe("paneLayoutStore persistence", () => {
  beforeEach(() => {
    resetPaneLayoutForTesting();
  });

  it("rehydrates a saved split and asks for one restore sync", async () => {
    await rehydrateWith({
      layout: {
        root: split("split-1", leaf("pane-1"), leaf("pane-2")),
        focusedPaneId: "pane-2",
        paneTargets: { "pane-1": serverTarget("thread-1"), "pane-2": serverTarget("thread-2") },
      },
    });
    assert.strictEqual(state().root.type, "split");
    assert.strictEqual(state().focusedPaneId, "pane-2");
    assert.isTrue(state().consumeRestoreSync());
    assert.isFalse(state().consumeRestoreSync());
  });

  it("rehydrates an empty save as a single pane without a restore sync", async () => {
    await rehydrateWith({ layout: null });
    assert.strictEqual(state().root.type, "leaf");
    assert.isFalse(state().consumeRestoreSync());
  });

  it("saves the layout while split and clears it once a lone pane remains", async () => {
    const { storage, name } = usePaneLayoutStore.persist.getOptions();
    state().splitFocusedPane("row", serverTarget("thread-1"));
    const saved = (await storage!.getItem(name!)) as { state: { layout: unknown } };
    assert.isNotNull(saved.state.layout);
    state().closeFocusedPane();
    const cleared = (await storage!.getItem(name!)) as { state: { layout: unknown } };
    assert.isNull(cleared.state.layout);
  });
});
