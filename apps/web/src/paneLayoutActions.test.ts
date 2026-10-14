// @vitest-environment jsdom

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, assert, beforeEach, describe, it, vi } from "vite-plus/test";

import { movePaneFocus, resolvePaneUrlSync, splitFocusedPane } from "./paneLayoutActions";
import { collectLeafIds, resetPaneLayoutForTesting, usePaneLayoutStore } from "./paneLayoutStore";
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

beforeEach(() => {
  resetPaneLayoutForTesting();
});

describe("splitFocusedPane", () => {
  it("starts a new thread for the new pane", () => {
    const startNewThread = vi.fn(async () => undefined);
    splitFocusedPane("row", serverTarget("thread-1"), startNewThread);
    assert.strictEqual(startNewThread.mock.calls.length, 1);
    assert.isNull(state().paneTargets[state().focusedPaneId] ?? null);
  });
});

describe("resolvePaneUrlSync", () => {
  function sync(input: {
    previous: { threadTarget: ThreadRouteTarget | null; focusedPaneId: string };
    threadTarget: ThreadRouteTarget | null;
  }) {
    return resolvePaneUrlSync({
      ...input,
      focusedPaneId: state().focusedPaneId,
      root: state().root,
      paneTargets: state().paneTargets,
    });
  }

  it("leaves the URL alone when focus lands on the new empty pane", () => {
    const original = state().focusedPaneId;
    const thread = serverTarget("thread-1");
    state().splitFocusedPane("row", thread);
    assert.deepEqual(
      sync({ previous: { threadTarget: thread, focusedPaneId: original }, threadTarget: thread }),
      { kind: "none" },
    );
  });

  it("puts the new thread into the empty focused pane", () => {
    const thread = serverTarget("thread-1");
    state().splitFocusedPane("row", thread);
    const draft: ThreadRouteTarget = { kind: "draft", draftId: "draft-1" as never };
    const focused = state().focusedPaneId;
    assert.deepEqual(
      sync({ previous: { threadTarget: thread, focusedPaneId: focused }, threadTarget: draft }),
      { kind: "retarget", target: draft },
    );
    // Also when the navigation landed before the layout first synced.
    assert.deepEqual(
      sync({ previous: { threadTarget: draft, focusedPaneId: focused }, threadTarget: draft }),
      { kind: "retarget", target: draft },
    );
  });

  it("moves the URL to a focused pane's thread", () => {
    const original = state().focusedPaneId;
    const first = serverTarget("thread-1");
    state().splitFocusedPane("row", first);
    const second = serverTarget("thread-2");
    state().setPaneTarget(state().focusedPaneId, second);
    const newPane = state().focusedPaneId;
    state().focusPane(original);
    assert.deepEqual(
      sync({ previous: { threadTarget: second, focusedPaneId: newPane }, threadTarget: second }),
      { kind: "navigate", target: first },
    );
  });

  it("focuses the pane that already shows a navigated thread", () => {
    const original = state().focusedPaneId;
    const first = serverTarget("thread-1");
    state().splitFocusedPane("row", first);
    const focused = state().focusedPaneId;
    state().setPaneTarget(focused, serverTarget("thread-2"));
    assert.deepEqual(
      sync({
        previous: { threadTarget: serverTarget("thread-2"), focusedPaneId: focused },
        threadTarget: first,
      }),
      { kind: "focus", paneId: original },
    );
  });
});

describe("movePaneFocus", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container.remove();
  });

  function mountPanes(rects: Record<string, { left: number; right: number }>) {
    container = document.createElement("div");
    document.body.append(container);
    for (const [paneId, rect] of Object.entries(rects)) {
      const pane = document.createElement("div");
      pane.dataset.paneId = paneId;
      pane.tabIndex = -1;
      pane.getBoundingClientRect = () =>
        ({ ...rect, top: 0, bottom: 600, width: rect.right - rect.left, height: 600 }) as DOMRect;
      const composer = document.createElement("div");
      composer.dataset.testid = "composer-editor";
      composer.tabIndex = 0;
      pane.append(composer);
      container.append(pane);
    }
  }

  it("focuses the neighbor and moves keyboard focus into its composer", () => {
    const original = state().focusedPaneId;
    state().splitFocusedPane("row", null);
    const added = state().focusedPaneId;
    mountPanes({ [original]: { left: 0, right: 500 }, [added]: { left: 501, right: 1000 } });

    assert.isTrue(movePaneFocus("left"));
    assert.strictEqual(state().focusedPaneId, original);
    assert.strictEqual(
      document.activeElement,
      container.querySelector(`[data-pane-id="${original}"] [data-testid="composer-editor"]`),
    );
    assert.isFalse(movePaneFocus("left"));
    assert.isTrue(movePaneFocus("right"));
    assert.strictEqual(state().focusedPaneId, added);
    assert.lengthOf(collectLeafIds(state().root), 2);
  });
});
