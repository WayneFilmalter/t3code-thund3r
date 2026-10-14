/**
 * Spring physics for the Agents map. Cells chase their packed rest positions on
 * underdamped springs and bounce off each other, which is what makes a bud pop out,
 * a returning subagent bump into its parent, and neighbours get nudged aside.
 *
 * Pure and allocation-light: the driver hook steps it once per animation frame only
 * while something is moving, then stops. Units are pixels and seconds.
 */
import type { AgentMapPacking } from "./agentMapLayout";

export interface RestBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly root: boolean;
  readonly docked: boolean;
}

export type RestMap = ReadonlyMap<string, RestBody>;

export interface SimBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly r: number;
  readonly mass: number;
  /** A newborn still inside its parent's membrane; it does not collide until it is out. */
  readonly emerging: boolean;
  /** A newborn waiting its turn in the opening bloom (ms); it sits still under its parent. */
  readonly holdMs: number;
}

export type SimState = ReadonlyArray<SimBody>;

/** Spring stiffness (1/s²) and damping (1/s): damping ratio ≈ 0.5, so cells overshoot a little. */
export const SPRING_K = 120;
export const SPRING_DAMPING = 11;
export const ROOT_MASS = 4;
const RESTITUTION = 0.3;
const MAX_DT_S = 0.032;
/** Inward kick a returning subagent gets, so it bumps its parent on arrival (px/s). */
export const DOCK_IMPULSE = 220;
/** Push the parent feels when a bud leaves it (px/s, before mass). */
const BIRTH_RECOIL = 90;
/** Gap between buds when a thread opens with subagents already in it (ms). */
export const BLOOM_STAGGER_MS = 90;
const SETTLED_SPEED = 20;
const SETTLED_OFFSET = 0.2;

export function restFromPacking(packing: AgentMapPacking): RestMap {
  const rest = new Map<string, RestBody>();
  rest.set(packing.root.id, { ...pick(packing.root), root: true, docked: packing.root.docked });
  for (const child of packing.children) {
    rest.set(child.id, { ...pick(child), root: false, docked: child.docked });
  }
  return rest;
}

function pick(cell: {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}) {
  return { id: cell.id, x: cell.x, y: cell.y, r: cell.r };
}

function rootOf(rest: RestMap): RestBody | null {
  for (const body of rest.values()) if (body.root) return body;
  return null;
}

/** Every body exactly at rest, for reduced motion and the first frame without animation. */
export function snapToRest(rest: RestMap): SimState {
  return [...rest.values()].map((body) => ({
    id: body.id,
    x: body.x,
    y: body.y,
    vx: 0,
    vy: 0,
    r: body.r,
    mass: body.root ? ROOT_MASS : 1,
    emerging: false,
    holdMs: 0,
  }));
}

/**
 * Brings the sim in line with a new rest set: newborns start at their parent's centre,
 * the parent recoils, and a child that just docked gets its inward kick. On the first
 * call (`previous` null) every child is a newborn, so they bud out one after another.
 */
export function reconcileBodies(
  state: SimState,
  rest: RestMap,
  previous: RestMap | null,
): SimState {
  const byId = new Map(state.map((body) => [body.id, body]));
  const restRoot = rootOf(rest);
  const root = restRoot === null ? null : (byId.get(restRoot.id) ?? null);
  const origin = root ?? restRoot;
  let recoilX = 0;
  let recoilY = 0;
  let births = 0;
  const next: SimBody[] = [];
  for (const target of rest.values()) {
    const existing = byId.get(target.id);
    if (existing) {
      let { vx, vy } = existing;
      const wasDocked = previous?.get(target.id)?.docked ?? target.docked;
      if (!target.root && target.docked && !wasDocked && origin !== null) {
        const [nx, ny] = unit(origin.x - existing.x, origin.y - existing.y);
        vx += nx * DOCK_IMPULSE;
        vy += ny * DOCK_IMPULSE;
      }
      next.push({ ...existing, vx, vy, r: target.r });
      continue;
    }
    if (target.root || origin === null) {
      next.push({
        id: target.id,
        x: target.x,
        y: target.y,
        vx: 0,
        vy: 0,
        r: target.r,
        mass: target.root ? ROOT_MASS : 1,
        emerging: false,
        holdMs: 0,
      });
      continue;
    }
    const [nx, ny] = unit(target.x - origin.x, target.y - origin.y);
    recoilX -= nx * BIRTH_RECOIL;
    recoilY -= ny * BIRTH_RECOIL;
    const holdMs = previous === null ? births * BLOOM_STAGGER_MS : 0;
    births += 1;
    next.push({
      id: target.id,
      x: origin.x,
      y: origin.y,
      vx: 0,
      vy: 0,
      r: target.r,
      mass: 1,
      emerging: true,
      holdMs,
    });
  }
  if (restRoot !== null && (recoilX !== 0 || recoilY !== 0)) {
    const index = next.findIndex((body) => body.id === restRoot.id);
    const body = next[index];
    if (body) {
      // Many buds at once (opening a finished thread) mostly cancel; cap what is left.
      const [rx, ry] = clampLength(recoilX / ROOT_MASS, recoilY / ROOT_MASS, BIRTH_RECOIL);
      next[index] = { ...body, vx: body.vx + rx, vy: body.vy + ry };
    }
  }
  return next;
}

function unit(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  return length === 0 ? [1, 0] : [x / length, y / length];
}

function clampLength(x: number, y: number, max: number): [number, number] {
  const length = Math.hypot(x, y);
  return length <= max ? [x, y] : [(x / length) * max, (y / length) * max];
}

/** Advances the sim by `dtMs`. `settled` means every cell is at rest and the loop can stop. */
export function stepCells(
  state: SimState,
  rest: RestMap,
  dtMs: number,
): { state: SimState; settled: boolean } {
  const dt = Math.min(MAX_DT_S, Math.max(0, dtMs / 1000));
  const restRoot = rootOf(rest);
  const bodies = state.map((body) => {
    const target = rest.get(body.id);
    if (!target) return { ...body };
    if (body.holdMs > 0) return { ...body, holdMs: Math.max(0, body.holdMs - dt * 1000) };
    const ax = SPRING_K * (target.x - body.x) - SPRING_DAMPING * body.vx;
    const ay = SPRING_K * (target.y - body.y) - SPRING_DAMPING * body.vy;
    const vx = body.vx + ax * dt;
    const vy = body.vy + ay * dt;
    return { ...body, vx, vy, x: body.x + vx * dt, y: body.y + vy * dt };
  });

  const root = restRoot === null ? null : bodies.find((body) => body.id === restRoot.id);
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index]!;
    if (!body.emerging || root === undefined || root === null) continue;
    // Out of the membrane: from here on it collides like everyone else.
    if (Math.hypot(body.x - root.x, body.y - root.y) >= root.r + body.r - 1) {
      bodies[index] = { ...body, emerging: false };
    }
  }

  for (let left = 0; left < bodies.length; left += 1) {
    for (let right = left + 1; right < bodies.length; right += 1) {
      const a = bodies[left]!;
      const b = bodies[right]!;
      if (a.emerging || b.emerging) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const penetration = a.r + b.r - distance;
      if (penetration <= 0) continue;
      const [nx, ny] = distance === 0 ? [1, 0] : [dx / distance, dy / distance];
      const inverseA = 1 / a.mass;
      const inverseB = 1 / b.mass;
      const share = penetration / (inverseA + inverseB);
      const ax = a.x - nx * share * inverseA;
      const ay = a.y - ny * share * inverseA;
      const bx = b.x + nx * share * inverseB;
      const by = b.y + ny * share * inverseB;
      let { vx: avx, vy: avy } = a;
      let { vx: bvx, vy: bvy } = b;
      const approach = (bvx - avx) * nx + (bvy - avy) * ny;
      if (approach < 0) {
        const impulse = (-(1 + RESTITUTION) * approach) / (inverseA + inverseB);
        avx -= impulse * inverseA * nx;
        avy -= impulse * inverseA * ny;
        bvx += impulse * inverseB * nx;
        bvy += impulse * inverseB * ny;
      }
      bodies[left] = { ...a, x: ax, y: ay, vx: avx, vy: avy };
      bodies[right] = { ...b, x: bx, y: by, vx: bvx, vy: bvy };
    }
  }

  const settled = bodies.every((body) => {
    const target = rest.get(body.id);
    if (!target) return true;
    return (
      !body.emerging &&
      body.holdMs === 0 &&
      Math.hypot(body.vx, body.vy) < SETTLED_SPEED &&
      Math.hypot(target.x - body.x, target.y - body.y) < SETTLED_OFFSET
    );
  });
  if (!settled) return { state: bodies, settled };
  // Land exactly on rest so the final frame is crisp.
  return {
    settled,
    state: bodies.map((body) => {
      const target = rest.get(body.id);
      return target ? { ...body, x: target.x, y: target.y, vx: 0, vy: 0 } : body;
    }),
  };
}
