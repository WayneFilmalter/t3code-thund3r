import { describe, expect, it } from "vite-plus/test";

import type { AgentBubble, AgentMapModel, AgentMapTask } from "./agentMap.logic";
import {
  createAgentMapPacker,
  foldTasks,
  limitVisibleChildren,
  LIVE_TETHER_GAP,
  MAX_CHILD_TASK_CELLS,
  MAX_VISIBLE_CHILDREN,
  packAgentMap,
  type AgentMapPacking,
} from "./agentMapLayout";

function bubble(overrides: Partial<AgentBubble> & { id: string }): AgentBubble {
  return {
    name: "Pip",
    kind: "subagent",
    status: "done",
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

function tasks(owner: string, count: number): AgentMapTask[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${owner}:t${index}`,
    label: "Edit",
    category: "edit" as const,
    count: index + 1,
    durationMs: 0,
  }));
}

function model(
  children: AgentBubble[],
  rootTasks: AgentMapTask[] = [],
  live = false,
): AgentMapModel {
  return {
    live,
    root: bubble({
      id: "root",
      kind: "main",
      status: live ? "idle" : "done",
      tokens: 1000,
      tasks: rootTasks,
      children,
    }),
  };
}

const SIZE = { width: 600, height: 520 };

/** Every circle in absolute coordinates, tagged with its owner. */
function circles(packing: AgentMapPacking) {
  const all: Array<{ id: string; owner: string | null; x: number; y: number; r: number }> = [];
  for (const cell of [packing.root, ...packing.children]) {
    all.push({
      id: cell.id,
      owner: cell.kind === "root" ? null : packing.root.id,
      x: cell.x,
      y: cell.y,
      r: cell.r,
    });
    for (const task of cell.tasks) {
      all.push({
        id: task.task.id,
        owner: cell.id,
        x: cell.x + task.dx,
        y: cell.y + task.dy,
        r: task.r,
      });
    }
  }
  return all;
}

function crowded(): AgentMapModel {
  const children = Array.from({ length: 11 }, (_, index) =>
    bubble({
      id: `child-${index}`,
      tokens: 100 * index,
      tasks: tasks(`child-${index}`, index % 4),
    }),
  );
  return model(children, tasks("root", 3));
}

describe("packAgentMap", () => {
  it("never lets two cells overlap by more than a pixel", () => {
    const all = circles(packAgentMap(crowded(), SIZE));
    for (let left = 0; left < all.length; left += 1) {
      for (let right = left + 1; right < all.length; right += 1) {
        const a = all[left]!;
        const b = all[right]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 1);
      }
    }
  });

  it("hugs tasks to their owner and leaves no cell floating alone", () => {
    const packing = packAgentMap(crowded(), SIZE);
    const all = circles(packing);
    const byId = new Map(all.map((circle) => [circle.id, circle]));
    const gap = (a: (typeof all)[number], b: (typeof all)[number]) =>
      Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
    for (const circle of all) {
      if (circle.owner === null) continue;
      if (circle.owner !== packing.root.id) {
        expect(gap(circle, byId.get(circle.owner)!)).toBeLessThanOrEqual(3);
      }
      const nearest = Math.min(
        ...all.filter((other) => other !== circle).map((other) => gap(circle, other)),
      );
      expect(nearest).toBeLessThanOrEqual(2);
    }
    const innerShell = packing.children.filter(
      (cell) => gap(byId.get(cell.id)!, byId.get(packing.root.id)!) < 2,
    );
    expect(innerShell.length).toBeGreaterThan(5);
  });

  it("holds live children out on a tether", () => {
    const packing = packAgentMap(model([bubble({ id: "live", status: "tool" })], [], true), SIZE);
    const child = packing.children[0]!;
    const gap =
      Math.hypot(child.x - packing.root.x, child.y - packing.root.y) - child.r - packing.root.r;
    expect(gap).toBeCloseTo(LIVE_TETHER_GAP * packing.scale, 0);
    expect(child.docked).toBe(false);
  });

  it("is deterministic and keeps model order", () => {
    const first = packAgentMap(crowded(), SIZE);
    expect(packAgentMap(crowded(), SIZE)).toEqual(first);
    expect(first.children.map((cell) => cell.id)).toEqual(
      crowded().root.children.map((child) => child.id),
    );
  });

  it("barely moves existing cells when a child joins", () => {
    const before = packAgentMap(
      model([bubble({ id: "a" }), bubble({ id: "b" }), bubble({ id: "c" })]),
      SIZE,
    );
    const after = packAgentMap(
      model([bubble({ id: "a" }), bubble({ id: "b" }), bubble({ id: "c" }), bubble({ id: "d" })]),
      SIZE,
    );
    for (const cell of before.children) {
      const moved = after.children.find((candidate) => candidate.id === cell.id)!;
      expect(Math.hypot(moved.x - cell.x, moved.y - cell.y)).toBeLessThan(cell.r / 2);
    }
  });

  it("shrinks to fit a small canvas", () => {
    const small = { width: 240, height: 200 };
    const packing = packAgentMap(crowded(), small);
    expect(packing.scale).toBeLessThan(1);
    for (const circle of circles(packing)) {
      expect(circle.x - circle.r).toBeGreaterThanOrEqual(-0.5);
      expect(circle.x + circle.r).toBeLessThanOrEqual(small.width + 0.5);
      expect(circle.y - circle.r).toBeGreaterThanOrEqual(-0.5);
      expect(circle.y + circle.r).toBeLessThanOrEqual(small.height + 0.5);
    }
  });
});

describe("foldTasks and the packer cache", () => {
  it("folds the oldest tasks into one cell past the cap", () => {
    const folded = foldTasks(tasks("c", 9), MAX_CHILD_TASK_CELLS, "c");
    expect(folded).toHaveLength(MAX_CHILD_TASK_CELLS);
    expect(folded[0]).toMatchObject({ id: "c:fold", label: "+4", count: 1 + 2 + 3 + 4 });
  });

  it("returns the same packing until the shape changes", () => {
    const pack = createAgentMapPacker();
    const first = pack(model([bubble({ id: "a", elapsedMs: 1 })]), SIZE);
    expect(pack(model([bubble({ id: "a", elapsedMs: 2_000 })]), SIZE)).toBe(first);
    expect(pack(model([bubble({ id: "a", status: "tool" })], [], true), SIZE)).not.toBe(first);
  });
});

describe("limitVisibleChildren", () => {
  it("folds the oldest subagents into one settled cell with summed tokens", () => {
    const children = Array.from({ length: MAX_VISIBLE_CHILDREN + 5 }, (_, index) =>
      bubble({ id: `c${index}`, tokens: 10 }),
    );
    const limited = limitVisibleChildren(model(children));
    expect(limited.root.children).toHaveLength(MAX_VISIBLE_CHILDREN);
    expect(limited.root.children[0]).toMatchObject({ name: "+6", status: "done", tokens: 60 });
    expect(limited.root.children.at(-1)?.id).toBe(`c${MAX_VISIBLE_CHILDREN + 4}`);
    const small = model([bubble({ id: "only" })]);
    expect(limitVisibleChildren(small)).toBe(small);
  });

  it("packs a folded busy cluster without overlaps", () => {
    const children = Array.from({ length: 60 }, (_, index) =>
      bubble({ id: `c${index}`, tokens: 50 * index, tasks: tasks(`c${index}`, 8) }),
    );
    const all = circles(
      packAgentMap(limitVisibleChildren(model(children, tasks("root", 24))), SIZE),
    );
    for (let left = 0; left < all.length; left += 1) {
      for (let right = left + 1; right < all.length; right += 1) {
        const a = all[left]!;
        const b = all[right]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 1);
      }
    }
  });
});
