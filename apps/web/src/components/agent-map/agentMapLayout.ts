/**
 * Radial placement for the Agents map, in viewBox units. Deterministic: angles are
 * hashed from ids so a bubble keeps its direction across renders, and siblings are
 * nudged apart so two hashes that collide still read as two bubbles.
 */
import { fnv1a32 } from "~/lib/hash";

import type { AgentBubble, AgentMapModel } from "./agentMap.logic";

export interface PlacedSatellite {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface PlacedTask {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface PlacedBubble {
  readonly bubble: AgentBubble;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly docked: boolean;
  readonly satellites: ReadonlyArray<PlacedSatellite>;
  readonly tasks: ReadonlyArray<PlacedTask>;
}

export interface AgentMapLayout {
  readonly width: number;
  readonly height: number;
  readonly root: PlacedBubble;
  readonly children: ReadonlyArray<PlacedBubble>;
}

const TWO_PI = Math.PI * 2;
export const CHILD_MIN_GAP_RAD = 0.6;
const SATELLITE_OFFSET = 10;
const TASK_OFFSET = 22;
const ROOT_TASK_OFFSET = 26;
export const TASK_RADIUS = 7;

export function hashedAngle(seed: string): number {
  return (fnv1a32(seed) / 0x1_0000_0000) * TWO_PI;
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** Sorted angles pushed apart until every neighbour gap is at least `minGap`. */
export function spreadAngles(angles: ReadonlyArray<number>, minGap: number): number[] {
  const count = angles.length;
  if (count < 2) return [...angles];
  const gap = Math.min(minGap, TWO_PI / count);
  const sorted = angles.map(normalizeAngle).sort((left, right) => left - right);
  for (let pass = 0; pass < count; pass += 1) {
    for (let index = 1; index < count; index += 1) {
      const previous = sorted[index - 1]!;
      if (sorted[index]! - previous < gap) sorted[index] = previous + gap;
    }
    // Close the circle: the last and first are neighbours too.
    const wrapGap = sorted[0]! + TWO_PI - sorted[count - 1]!;
    if (wrapGap >= gap) break;
    const shift = (gap - wrapGap) / 2;
    sorted[0] = sorted[0]! + shift;
    sorted[count - 1] = sorted[count - 1]! - shift;
    sorted.sort((left, right) => left - right);
  }
  return sorted;
}

function isDocked(bubble: AgentBubble): boolean {
  return bubble.status === "done" || bubble.status === "failed";
}

function placeSatellites(bubble: AgentBubble, x: number, y: number, r: number): PlacedSatellite[] {
  const orbit = r + SATELLITE_OFFSET;
  return bubble.satellites.map((satellite) => {
    const angle = hashedAngle(`${satellite.id}:sat`);
    return { id: satellite.id, x: x + Math.cos(angle) * orbit, y: y + Math.sin(angle) * orbit };
  });
}

/** Task bubbles fan across `spanRad` centred on `centerAngle`. */
function placeTasks(
  bubble: AgentBubble,
  x: number,
  y: number,
  orbit: number,
  centerAngle: number,
  spanRad: number,
): PlacedTask[] {
  const count = bubble.tasks.length;
  if (count === 0) return [];
  const step = count === 1 ? 0 : spanRad / (count - 1);
  const start = centerAngle - spanRad / 2;
  return bubble.tasks.map((task, index) => {
    const angle = count === 1 ? centerAngle : start + step * index;
    return {
      id: task.id,
      x: x + Math.cos(angle) * orbit,
      y: y + Math.sin(angle) * orbit,
      r: TASK_RADIUS,
    };
  });
}

export function layoutAgentMap(
  model: AgentMapModel,
  size: { readonly width: number; readonly height: number },
): AgentMapLayout {
  const { width, height } = size;
  const unit = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const rootR = unit * 0.16;
  const rootTokens = Math.max(model.root.tokens ?? 0, 1);
  const rMin = unit * 0.07;
  const rMax = unit * 0.12;

  const root: PlacedBubble = {
    bubble: model.root,
    x: cx,
    y: cy,
    r: rootR,
    docked: !model.live,
    satellites: placeSatellites(model.root, cx, cy, rootR),
    tasks: placeTasks(
      model.root,
      cx,
      cy,
      rootR + ROOT_TASK_OFFSET,
      -Math.PI / 2,
      TWO_PI * (1 - 1 / Math.max(model.root.tasks.length, 1)),
    ),
  };

  const raw = model.root.children.map((child) => hashedAngle(`${child.id}:angle`));
  const order = raw
    .map((angle, index) => ({ angle: normalizeAngle(angle), index }))
    .sort((left, right) => left.angle - right.angle);
  const spread = spreadAngles(raw, CHILD_MIN_GAP_RAD);
  const children: PlacedBubble[] = order.map(({ index }, position) => {
    const child = model.root.children[index]!;
    const angle = spread[position]!;
    const docked = isDocked(child);
    const orbit = unit * (docked ? 0.26 : 0.38);
    const x = cx + Math.cos(angle) * orbit;
    const y = cy + Math.sin(angle) * orbit;
    const share = child.tokens === null ? 0 : Math.sqrt(Math.min(1, child.tokens / rootTokens));
    const r = rMin + (rMax - rMin) * share;
    return {
      bubble: child,
      x,
      y,
      r,
      docked,
      satellites: placeSatellites(child, x, y, r),
      tasks: placeTasks(child, x, y, r + TASK_OFFSET, angle, Math.PI * 0.8),
    };
  });
  // Keep children in model order so React keys and spawn animations stay stable.
  children.sort(
    (left, right) =>
      model.root.children.indexOf(left.bubble) - model.root.children.indexOf(right.bubble),
  );
  return { width, height, root, children };
}
