/**
 * Rest positions for the Agents map, found by packing circles like cells in tissue.
 *
 * The root sits pinned in the middle. Finished children dock against it, live ones
 * hover a tether's length out, and each cell's task bubbles cling to its outer side.
 * Every pair keeps a hairline gap, so cells kiss but never cross. The solver is
 * deterministic: angles come from hashed ids, so the same thread packs the same way.
 *
 * Only shape feeds the solver (ids, radii, docking, task counts). Elapsed time and
 * satellites change every second and never trigger a repack; see `createAgentMapPacker`.
 *
 * Packing happens in a fixed reference space with the root at the origin. The canvas
 * scales that space to fit its box and applies zoom, so resizing never repacks.
 */
import { fnv1a32 } from "~/lib/hash";

import type { AgentBubble, AgentMapModel, AgentMapTask } from "./agentMap.logic";
import { AGENT_MAP_ACCENTS } from "./agentMapColors";

const TWO_PI = Math.PI * 2;
/** Hairline between touching cells. */
export const CELL_GAP = 1;
/** How far a live child hovers out from its parent. */
export const LIVE_TETHER_GAP = 26;
export const MAX_CHILD_TASK_CELLS = 6;
/** In a busy cluster each child keeps fewer task cells, so the tissue stays readable. */
export const MAX_CHILD_TASK_CELLS_CROWDED = 3;
const CROWDED_CHILDREN = 12;
/** Older subagents beyond this fold into one "+k" cell. */
export const MAX_VISIBLE_CHILDREN = 24;
export const MAX_ROOT_TASK_CELLS = 12;
const CHILD_ITERATIONS = 120;
const TASK_ITERATIONS = 70;
/** Extra room when deciding which cells a mover could ever touch. */
const REACH_SLACK = 24;
const MAX_PULL_STEP = 3;

export function hashedAngle(seed: string): number {
  return (fnv1a32(seed) / 0x1_0000_0000) * TWO_PI;
}

export interface PackedTask {
  readonly task: AgentMapTask;
  /** Offset from the owner's centre, so the task floats with its owner. */
  readonly dx: number;
  readonly dy: number;
  readonly r: number;
}

export interface PackedCell {
  readonly id: string;
  readonly kind: "root" | "child";
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly docked: boolean;
  readonly tasks: ReadonlyArray<PackedTask>;
}

export interface AgentMapPacking {
  /** Distance from the root's centre to the cluster's outermost edge. */
  readonly extent: number;
  readonly root: PackedCell;
  /** In model order, so React keys and physics bodies stay put. */
  readonly children: ReadonlyArray<PackedCell>;
}

/** Reference-space root radius; the canvas scales everything to fit. */
export const ROOT_RADIUS = 64;

/** Scale that fits a packing in a box (grows and shrinks with it), before user zoom. */
export function fitScale(
  extent: number,
  box: { readonly width: number; readonly height: number },
  margin = 14,
): number {
  const available = Math.min(box.width, box.height) / 2 - margin;
  if (available <= 0 || extent <= 0) return 1;
  return Math.min(2.4, Math.max(0.3, available / extent));
}

export function childRadius(tokens: number | null, rootTokens: number | null): number {
  const share =
    tokens === null || rootTokens === null || rootTokens <= 0
      ? 0
      : Math.min(1, tokens / rootTokens);
  return 30 + 10 * Math.sqrt(share);
}

/** Grows a step each time the count doubles, so ×2 and ×20 read differently, up to ×16. */
export function taskRadius(count: number): number {
  return Math.min(24, 12 + 3 * Math.log2(Math.max(1, count)));
}

function isDocked(bubble: AgentBubble): boolean {
  return bubble.status === "done" || bubble.status === "failed";
}

/** Keeps a cluster readable: beyond `max`, the oldest tasks fold into one "+k" cell. */
export function foldTasks(
  tasks: ReadonlyArray<AgentMapTask>,
  max: number,
  ownerId: string,
): AgentMapTask[] {
  if (tasks.length <= max) return [...tasks];
  const folded = tasks.slice(0, tasks.length - max + 1);
  return [
    {
      id: `${ownerId}:fold`,
      label: `+${folded.length}`,
      category: "other",
      count: folded.reduce((total, task) => total + task.count, 0),
      durationMs: folded.reduce((total, task) => total + task.durationMs, 0),
    },
    ...tasks.slice(tasks.length - max + 1),
  ];
}

/**
 * Keeps the newest subagents and folds the rest into one settled "+k" cell. Run before
 * packing and rendering; the folded cell carries the summed tokens and time.
 */
export function limitVisibleChildren(model: AgentMapModel): AgentMapModel {
  const children = model.root.children;
  if (children.length <= MAX_VISIBLE_CHILDREN) return model;
  const folded = children.slice(0, children.length - MAX_VISIBLE_CHILDREN + 1);
  const sum = (values: ReadonlyArray<number | null>) =>
    values.some((value) => value !== null)
      ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null;
  const earlier: AgentBubble = {
    id: `${model.root.id}:earlier`,
    name: `+${folded.length}`,
    kind: "subagent",
    accent: AGENT_MAP_ACCENTS.stalled,
    status: "done",
    subtitle: "Earlier agents",
    tokens: sum(folded.map((child) => child.tokens)),
    elapsedMs: sum(folded.map((child) => child.elapsedMs)),
    contextFraction: null,
    compacted: false,
    model: null,
    detail: `${folded.length} earlier subagents`,
    effort: null,
    toolCount: null,
    preview: null,
    lastActivityAtMs: null,
    satellites: [],
    tasks: [],
    children: [],
  };
  return {
    ...model,
    root: { ...model.root, children: [earlier, ...children.slice(folded.length)] },
  };
}

interface Body {
  x: number;
  y: number;
  /** Pinned bodies push but are never pushed. The root always is; children are in phase two. */
  pinned: boolean;
  readonly r: number;
  /** Index of the body this one clings to; -1 for the pinned root. */
  readonly owner: number;
  /** Centre distance to keep from the owner. */
  readonly reach: number;
}

function seedOnOwner(owner: Body, angle: number, reach: number): { x: number; y: number } {
  return { x: owner.x + Math.cos(angle) * reach, y: owner.y + Math.sin(angle) * reach };
}

/** One relaxation pass: cling to the owner, then push apart overlapping pairs `collisions` times. */
function relax(bodies: Body[], pairs: Pairs, collisions: number): void {
  for (let index = 1; index < bodies.length; index += 1) {
    const body = bodies[index]!;
    if (body.pinned) continue;
    const owner = bodies[body.owner]!;
    const dx = body.x - owner.x;
    const dy = body.y - owner.y;
    const distance = Math.hypot(dx, dy) || 1;
    // Small steps, so a cell cannot tunnel through a closed ring of neighbours.
    const pull = Math.max(-MAX_PULL_STEP, Math.min(MAX_PULL_STEP, (body.reach - distance) * 0.5));
    body.x += (dx / distance) * pull;
    body.y += (dy / distance) * pull;
  }
  for (let pass = 0; pass < collisions; pass += 1) separate(bodies, pairs);
}

/** Flat `[a, b, a, b, ...]` index pairs that can possibly touch during a solve. */
type Pairs = ReadonlyArray<number>;

/**
 * Pairs worth checking: at least one side moves, and the mover can reach the other.
 * A moving cell never strays far from its owner, so anything well beyond the owner's
 * neighbourhood is skipped. That keeps a 60-subagent thread to a few milliseconds.
 */
function collisionPairs(bodies: ReadonlyArray<Body>): number[] {
  const pairs: number[] = [];
  for (let left = 0; left < bodies.length; left += 1) {
    const a = bodies[left]!;
    for (let right = left + 1; right < bodies.length; right += 1) {
      const b = bodies[right]!;
      if (a.pinned && b.pinned) continue;
      if (canMeet(bodies, a, b) || canMeet(bodies, b, a)) pairs.push(left, right);
    }
  }
  return pairs;
}

/** Whether `mover`, travelling around its owner, can come within touching distance of `other`. */
function canMeet(bodies: ReadonlyArray<Body>, mover: Body, other: Body): boolean {
  if (mover.pinned || mover.owner < 0) return false;
  const owner = bodies[mover.owner]!;
  // The mover keeps within a couple of its own diameters of its resting reach.
  const range = mover.reach + mover.r * 4 + other.r + REACH_SLACK;
  return (other.x - owner.x) ** 2 + (other.y - owner.y) ** 2 < range * range;
}

/** Late passes separate harder so contacts end exact rather than slightly crossed. */
function solve(bodies: Body[], iterations: number): void {
  const pairs = collisionPairs(bodies);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    relax(bodies, pairs, iteration < iterations - 30 ? 1 : 4);
  }
  for (let pass = 0; pass < 20; pass += 1) separate(bodies, pairs);
  rehomeWedged(bodies);
}

function separate(bodies: Body[], pairs: Pairs): void {
  for (let pair = 0; pair < pairs.length; pair += 2) {
    const a = bodies[pairs[pair]!]!;
    const b = bodies[pairs[pair + 1]!]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minDistance = a.r + b.r + CELL_GAP;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= minDistance * minDistance) continue;
    const distance = Math.sqrt(distanceSquared);
    const overlap = minDistance - distance;
    const nx = distance === 0 ? 1 : dx / distance;
    const ny = distance === 0 ? 0 : dy / distance;
    const aShare = a.pinned ? 0 : b.pinned ? 1 : 0.5;
    const bShare = 1 - aShare;
    a.x -= nx * overlap * aShare;
    a.y -= ny * overlap * aShare;
    b.x += nx * overlap * bShare;
    b.y += ny * overlap * bShare;
  }
}

function overlapsAny(bodies: ReadonlyArray<Body>, index: number, x: number, y: number): boolean {
  const body = bodies[index]!;
  for (let other = 0; other < bodies.length; other += 1) {
    if (other === index) continue;
    const neighbour = bodies[other]!;
    const minDistance = body.r + neighbour.r + CELL_GAP - 0.5;
    if ((neighbour.x - x) ** 2 + (neighbour.y - y) ** 2 < minDistance * minDistance) return true;
  }
  return false;
}

/**
 * A cell wedged between two fixed neighbours can only bounce between them. Move it to
 * the nearest free spot around its owner instead: sweep angles from where it sits,
 * stepping outward until something fits. Deterministic, and it makes overlap impossible.
 */
function rehomeWedged(bodies: Body[]): void {
  for (let index = 1; index < bodies.length; index += 1) {
    const body = bodies[index]!;
    if (body.pinned || !overlapsAny(bodies, index, body.x, body.y)) continue;
    const owner = bodies[body.owner]!;
    const start = Math.atan2(body.y - owner.y, body.x - owner.x);
    const stride = Math.max(2, body.r / 2);
    search: for (let ring = 0; ring < 400; ring += 1) {
      const reach = body.reach + ring * stride;
      for (let step = 0; step <= 72; step += 1) {
        const offset = Math.ceil(step / 2) * (TWO_PI / 72) * (step % 2 === 0 ? 1 : -1);
        const x = owner.x + Math.cos(start + offset) * reach;
        const y = owner.y + Math.sin(start + offset) * reach;
        if (overlapsAny(bodies, index, x, y)) continue;
        body.x = x;
        body.y = y;
        break search;
      }
    }
  }
}

/** Smallest angle between two cells on one ring around the root so they only kiss. */
function minSeparation(
  a: { readonly r: number; readonly reach: number },
  b: { readonly r: number; readonly reach: number },
): number {
  const contact = a.r + b.r + CELL_GAP;
  const cosine = (a.reach ** 2 + b.reach ** 2 - contact ** 2) / (2 * a.reach * b.reach);
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}

interface Seat {
  readonly index: number;
  readonly r: number;
  readonly reach: number;
  angle: number;
}

/**
 * Seats cells around the root in spawn order until the ring is full, each as close to
 * its hashed angle as its neighbours allow. Returns the seated cells with final angles.
 */
export function seatInnerShell(
  cells: ReadonlyArray<{ index: number; angle: number; r: number; reach: number }>,
): Seat[] {
  const seated: Seat[] = [];
  for (const cell of cells) {
    const candidate = [...seated, { ...cell, angle: normalizeAngle(cell.angle) }];
    candidate.sort((left, right) => left.angle - right.angle);
    let needed = 0;
    for (let position = 0; position < candidate.length; position += 1) {
      needed += minSeparation(candidate[position]!, candidate[(position + 1) % candidate.length]!);
    }
    if (candidate.length > 1 && needed > TWO_PI) continue;
    seated.splice(0, seated.length, ...candidate);
  }
  spreadSeats(seated);
  return seated;
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** Pushes neighbours apart in both directions until every pair kisses at most. */
function spreadSeats(seats: Seat[]): void {
  const count = seats.length;
  if (count < 2) return;
  const need = seats.map((seat, position) => minSeparation(seat, seats[(position + 1) % count]!));
  for (let pass = 0; pass < 400; pass += 1) {
    let moved = false;
    for (let position = 0; position < count - 1; position += 1) {
      const short = seats[position]!.angle + need[position]! - seats[position + 1]!.angle;
      if (short > 1e-9) {
        seats[position]!.angle -= short / 2;
        seats[position + 1]!.angle += short / 2;
        moved = true;
      }
    }
    const wrapShort = seats[count - 1]!.angle + need[count - 1]! - (seats[0]!.angle + TWO_PI);
    if (wrapShort > 1e-9) {
      seats[count - 1]!.angle -= wrapShort / 2;
      seats[0]!.angle += wrapShort / 2;
      moved = true;
    }
    if (!moved) break;
  }
}

export function packAgentMap(model: AgentMapModel): AgentMapPacking {
  const cx = 0;
  const cy = 0;
  const rootR = ROOT_RADIUS;
  const bodies: Body[] = [{ x: cx, y: cy, pinned: true, r: rootR, owner: -1, reach: 0 }];

  const children = model.root.children.map((child) => {
    const r = childRadius(child.tokens, model.root.tokens);
    const docked = isDocked(child);
    const reach = rootR + r + (docked ? CELL_GAP : LIVE_TETHER_GAP);
    const angle = hashedAngle(`${child.id}:angle`);
    const index = bodies.length;
    bodies.push({ ...seedOnOwner(bodies[0]!, angle, reach), pinned: false, r, owner: 0, reach });
    return { child, index, angle, docked };
  });

  const placeTasks = (
    tasks: ReadonlyArray<AgentMapTask>,
    ownerIndex: number,
    outward: number,
  ): Array<{ task: AgentMapTask; index: number }> => {
    const owner = bodies[ownerIndex]!;
    return tasks.map((task, position) => {
      const r = taskRadius(task.count);
      const reach = owner.r + r + CELL_GAP;
      // Fan neighbours by the angle one task subtends, centred on the outward side.
      const step = 2 * Math.asin(Math.min(1, (r + CELL_GAP) / reach));
      const angle = outward + (position - (tasks.length - 1) / 2) * step;
      const index = bodies.length;
      bodies.push({
        ...seedOnOwner(owner, angle, reach),
        pinned: false,
        r,
        owner: ownerIndex,
        reach,
      });
      return { task, index };
    });
  };

  const rootTasks = placeTasks(
    foldTasks(model.root.tasks, MAX_ROOT_TASK_CELLS, model.root.id),
    0,
    hashedAngle(`${model.root.id}:tasks`),
  );

  // Phase one: the first-born children take seats around the root, nudged apart just
  // enough to touch. Whoever does not fit settles into the grooves of a second shell.
  // Phase two, after everything seated so far is frozen, packs the children's tasks.
  // The root's own task cells queue for seats after the children.
  const shell = seatInnerShell([
    ...children.map(({ index, angle }) => ({
      index,
      angle,
      r: bodies[index]!.r,
      reach: bodies[index]!.reach,
    })),
    ...rootTasks.map(({ index }) => {
      const body = bodies[index]!;
      return { index, angle: Math.atan2(body.y - cy, body.x - cx), r: body.r, reach: body.reach };
    }),
  ]);
  const seatedIndexes = new Set<number>();
  let ringOuterEdge = rootR;
  for (const seat of shell) {
    const body = bodies[seat.index]!;
    Object.assign(body, seedOnOwner(bodies[0]!, seat.angle, body.reach));
    body.pinned = true;
    seatedIndexes.add(seat.index);
    ringOuterEdge = Math.max(ringOuterEdge, body.reach + body.r);
  }
  // A full ring is closed: anything left inside it would be trapped in a pocket too
  // small to hold it. Start the overflow outside the ring and let it settle inward.
  for (let index = 1; index < bodies.length; index += 1) {
    if (seatedIndexes.has(index)) continue;
    const body = bodies[index]!;
    const angle = Math.atan2(body.y - cy, body.x - cx);
    Object.assign(body, seedOnOwner(bodies[0]!, angle, ringOuterEdge + body.r + CELL_GAP));
  }
  solve(bodies, CHILD_ITERATIONS);
  for (const body of bodies) body.pinned = true;

  const childTasks = children.map(({ child, index }) => {
    const body = bodies[index]!;
    const outward = Math.atan2(body.y - bodies[0]!.y, body.x - bodies[0]!.x);
    const cap =
      children.length > CROWDED_CHILDREN ? MAX_CHILD_TASK_CELLS_CROWDED : MAX_CHILD_TASK_CELLS;
    return placeTasks(foldTasks(child.tasks, cap, child.id), index, outward);
  });

  // Phase two: tasks settle around their now fixed owners.
  solve(bodies, TASK_ITERATIONS);

  let extent = rootR;
  for (const body of bodies)
    extent = Math.max(extent, Math.hypot(body.x - cx, body.y - cy) + body.r);
  const at = (body: Body) => ({ x: body.x, y: body.y, r: body.r });
  const tasksFor = (
    placed: ReadonlyArray<{ task: AgentMapTask; index: number }>,
    owner: Body,
  ): PackedTask[] =>
    placed.map(({ task, index }) => {
      const body = bodies[index]!;
      return {
        task,
        dx: body.x - owner.x,
        dy: body.y - owner.y,
        r: body.r,
      };
    });

  const rootBody = bodies[0]!;
  return {
    extent,
    root: {
      id: model.root.id,
      kind: "root",
      ...at(rootBody),
      docked: !model.live,
      tasks: tasksFor(rootTasks, rootBody),
    },
    children: children.map(({ child, index, docked }, position) => {
      const body = bodies[index]!;
      return {
        id: child.id,
        kind: "child" as const,
        ...at(body),
        docked,
        tasks: tasksFor(childTasks[position]!, body),
      };
    }),
  };
}

/** What the packing depends on. Anything else changing must not cost a repack. */
export function agentMapShapeKey(model: AgentMapModel): string {
  const rootTokens = model.root.tokens;
  const parts = [model.root.id, model.live ? "L" : "S", taskKey(model.root.tasks)];
  for (const child of model.root.children) {
    parts.push(
      `${child.id}:${isDocked(child) ? "d" : "l"}:${Math.round(childRadius(child.tokens, rootTokens))}:${taskKey(child.tasks)}`,
    );
  }
  return parts.join("|");
}

function taskKey(tasks: ReadonlyArray<AgentMapTask>): string {
  return tasks.map((task) => `${task.id}x${task.count}`).join(",");
}

/**
 * A packer with a one-entry cache: same shape and size returns the same object, which
 * also keeps the physics from restarting on every clock tick.
 */
export function createAgentMapPacker() {
  let lastKey: string | null = null;
  let last: AgentMapPacking | null = null;
  return (model: AgentMapModel): AgentMapPacking => {
    const key = agentMapShapeKey(model);
    if (key !== lastKey || last === null) {
      lastKey = key;
      last = packAgentMap(model);
    }
    return last;
  };
}
