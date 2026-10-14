import { describe, expect, it } from "vite-plus/test";

import {
  BLOOM_STAGGER_MS,
  reconcileBodies,
  snapToRest,
  stepCells,
  type RestBody,
  type RestMap,
  type SimState,
} from "./agentMapPhysics";

const FRAME_MS = 16;

function restMap(bodies: Array<Partial<RestBody> & { id: string; x: number; y: number }>): RestMap {
  return new Map(
    bodies.map((body) => [body.id, { r: 20, root: false, docked: true, ...body }] as const),
  );
}

function run(state: SimState, rest: RestMap, frames: number, onFrame?: (state: SimState) => void) {
  let current = state;
  let settledAt: number | null = null;
  for (let frame = 0; frame < frames; frame += 1) {
    const result = stepCells(current, rest, FRAME_MS);
    current = result.state;
    onFrame?.(current);
    if (result.settled && settledAt === null) settledAt = frame;
  }
  return { state: current, settledAt };
}

const byId = (state: SimState, id: string) => state.find((body) => body.id === id)!;

describe("stepCells", () => {
  const rest = restMap([
    { id: "root", x: 200, y: 200, r: 60, root: true },
    { id: "a", x: 281, y: 200 },
  ]);

  it("converges to rest from an offset and settles within three seconds", () => {
    const start = snapToRest(rest).map((body) =>
      body.id === "a" ? { ...body, x: 330, y: 230 } : body,
    );
    const { state, settledAt } = run(start, rest, Math.ceil(3_000 / FRAME_MS));
    expect(settledAt).not.toBeNull();
    expect(byId(state, "a")).toMatchObject({ x: 281, y: 200, vx: 0, vy: 0 });
  });

  it("reports settled immediately when already at rest", () => {
    expect(stepCells(snapToRest(rest), rest, FRAME_MS).settled).toBe(true);
  });

  it("clamps a long frame so the sim cannot explode", () => {
    const start = snapToRest(rest).map((body) => (body.id === "a" ? { ...body, x: 400 } : body));
    const { state } = stepCells(start, rest, 5_000);
    expect(Math.abs(byId(state, "a").x - 281)).toBeLessThan(400 - 281);
  });

  it("pushes an overlapping neighbour, and both find their way back", () => {
    const pair = restMap([
      { id: "root", x: 0, y: 0, r: 40, root: true },
      { id: "a", x: 100, y: 0 },
      { id: "b", x: 141, y: 0 },
    ]);
    const start = snapToRest(pair).map((body) => (body.id === "a" ? { ...body, x: 125 } : body));
    let pushed = 0;
    const { state, settledAt } = run(start, pair, 250, (frame) => {
      pushed = Math.max(pushed, byId(frame, "b").x - 141);
    });
    expect(pushed).toBeGreaterThan(1);
    expect(settledAt).not.toBeNull();
    expect(byId(state, "b").x).toBe(141);
  });
});

describe("reconcileBodies", () => {
  it("buds a newborn from the parent's centre and recoils the parent", () => {
    const before = restMap([{ id: "root", x: 200, y: 200, r: 60, root: true }]);
    const after = restMap([
      { id: "root", x: 200, y: 200, r: 60, root: true },
      { id: "kid", x: 290, y: 200, docked: false },
    ]);
    const state = reconcileBodies(snapToRest(before), after, before);
    expect(byId(state, "kid")).toMatchObject({ x: 200, y: 200, emerging: true });
    expect(byId(state, "root").vx).toBeLessThan(0);

    let maxDistance = 0;
    const { state: final, settledAt } = run(state, after, 250, (frame) => {
      maxDistance = Math.max(maxDistance, byId(frame, "kid").x - 200);
    });
    // It pops past its rest spot before settling.
    expect(maxDistance).toBeGreaterThan(90.5);
    expect(settledAt).not.toBeNull();
    expect(byId(final, "kid").emerging).toBe(false);
  });

  it("buds children one after another when a thread opens", () => {
    const rest = restMap([
      { id: "root", x: 200, y: 200, r: 60, root: true },
      { id: "a", x: 281, y: 200 },
      { id: "b", x: 119, y: 200 },
      { id: "c", x: 200, y: 281 },
    ]);
    const opened = reconcileBodies([], rest, null);
    expect(opened.map((body) => body.holdMs)).toEqual([
      0,
      0,
      BLOOM_STAGGER_MS,
      BLOOM_STAGGER_MS * 2,
    ]);
    // While held, the last bud stays under its parent; then it leaves and everyone settles.
    const early = run(opened, rest, 5).state;
    expect(byId(early, "c")).toMatchObject({ x: 200, y: 200 });
    expect(byId(early, "a").x).toBeGreaterThan(200);
    const { state, settledAt } = run(opened, rest, 300);
    expect(settledAt).not.toBeNull();
    expect(byId(state, "c")).toMatchObject({ x: 200, y: 281, holdMs: 0 });
  });

  it("kicks a docking child inward so it overshoots into its parent", () => {
    const live = restMap([
      { id: "root", x: 0, y: 0, r: 60, root: true },
      { id: "kid", x: 106, y: 0, docked: false },
    ]);
    const docked = restMap([
      { id: "root", x: 0, y: 0, r: 60, root: true },
      { id: "kid", x: 81, y: 0, docked: true },
    ]);
    const state = reconcileBodies(snapToRest(live), docked, live);
    expect(byId(state, "kid").vx).toBeLessThan(0);
    let closest = Infinity;
    let rootMoved = 0;
    const { settledAt } = run(state, docked, 250, (frame) => {
      closest = Math.min(closest, byId(frame, "kid").x - byId(frame, "root").x);
      rootMoved = Math.max(rootMoved, Math.abs(byId(frame, "root").x));
    });
    expect(closest).toBeLessThan(81);
    expect(rootMoved).toBeGreaterThan(0);
    expect(settledAt).not.toBeNull();
  });

  it("drops bodies that left the map and keeps existing motion", () => {
    const rest = restMap([{ id: "root", x: 0, y: 0, r: 60, root: true }]);
    const state = reconcileBodies(
      [
        { id: "root", x: 3, y: 0, vx: 5, vy: 0, r: 60, mass: 4, emerging: false, holdMs: 0 },
        { id: "gone", x: 90, y: 0, vx: 0, vy: 0, r: 20, mass: 1, emerging: false, holdMs: 0 },
      ],
      rest,
      rest,
    );
    expect(state.map((body) => body.id)).toEqual(["root"]);
    expect(byId(state, "root")).toMatchObject({ x: 3, vx: 5 });
  });
});
