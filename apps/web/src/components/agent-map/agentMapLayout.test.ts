import { describe, expect, it } from "vite-plus/test";

import type { AgentBubble, AgentMapModel } from "./agentMap.logic";
import { CHILD_MIN_GAP_RAD, layoutAgentMap, spreadAngles } from "./agentMapLayout";

function bubble(overrides: Partial<AgentBubble> & { id: string }): AgentBubble {
  return {
    name: "Pip",
    kind: "subagent",
    status: "tool",
    subtitle: "",
    tokens: null,
    elapsedMs: null,
    contextFraction: null,
    compacted: false,
    satellites: [],
    tasks: [],
    children: [],
    ...overrides,
  };
}

function model(children: AgentBubble[], live = true): AgentMapModel {
  return {
    live,
    root: bubble({
      id: "root",
      kind: "main",
      status: live ? "idle" : "done",
      tokens: 1000,
      children,
    }),
  };
}

const SIZE = { width: 400, height: 300 };

describe("layoutAgentMap", () => {
  it("is deterministic for the same input", () => {
    const children = [bubble({ id: "a" }), bubble({ id: "b" }), bubble({ id: "c" })];
    const first = layoutAgentMap(model(children), SIZE);
    const second = layoutAgentMap(model(children), SIZE);
    expect(first).toEqual(second);
    expect(first.root).toMatchObject({ x: 200, y: 150 });
  });

  it("keeps children in model order and pushes colliding angles apart", () => {
    const children = Array.from({ length: 6 }, (_, index) => bubble({ id: `child-${index}` }));
    const layout = layoutAgentMap(model(children), SIZE);
    expect(layout.children.map((placed) => placed.bubble.id)).toEqual(
      children.map((child) => child.id),
    );
    const angles = layout.children
      .map((placed) => Math.atan2(placed.y - 150, placed.x - 200))
      .map((angle) => (angle < 0 ? angle + Math.PI * 2 : angle))
      .sort((left, right) => left - right);
    const minGap = Math.min(CHILD_MIN_GAP_RAD, (Math.PI * 2) / children.length);
    for (let index = 1; index < angles.length; index += 1) {
      expect(angles[index]! - angles[index - 1]!).toBeGreaterThanOrEqual(minGap - 1e-9);
    }
  });

  it("docks finished children closer than live ones and sizes by token share", () => {
    const layout = layoutAgentMap(
      model([
        bubble({ id: "live", tokens: 1000 }),
        bubble({ id: "done", status: "done", tokens: 10 }),
      ]),
      SIZE,
    );
    const [live, done] = layout.children;
    const distance = (placed: { x: number; y: number }) =>
      Math.hypot(placed.x - 200, placed.y - 150);
    expect(distance(done!)).toBeLessThan(distance(live!));
    expect(done!.docked).toBe(true);
    expect(live!.r).toBeGreaterThan(done!.r);
  });

  it("fans tasks on the far side of a child and rings them around the root", () => {
    const tasks = [
      { id: "t1", label: "Research", category: "read" as const, durationMs: 0 },
      { id: "t2", label: "Edit", category: "edit" as const, durationMs: 0 },
    ];
    const layout = layoutAgentMap(model([bubble({ id: "c", status: "done", tasks })], false), SIZE);
    const child = layout.children[0]!;
    expect(child.tasks).toHaveLength(2);
    for (const task of child.tasks) {
      expect(Math.hypot(task.x - 200, task.y - 150)).toBeGreaterThan(
        Math.hypot(child.x - 200, child.y - 150),
      );
    }
    const rooted = layoutAgentMap(
      { ...model([], false), root: bubble({ id: "root", kind: "main", status: "done", tasks }) },
      SIZE,
    );
    expect(rooted.root.tasks).toHaveLength(2);
  });
});

describe("spreadAngles", () => {
  it("leaves well separated angles alone and spreads collisions", () => {
    expect(spreadAngles([0, 2, 4], 0.6)).toEqual([0, 2, 4]);
    const spread = spreadAngles([1, 1, 1.1], 0.6);
    expect(spread[1]! - spread[0]!).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(spread[2]! - spread[1]!).toBeGreaterThanOrEqual(0.6 - 1e-9);
  });
});
