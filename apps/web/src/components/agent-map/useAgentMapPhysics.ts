/**
 * Drives the cell physics. Steps the pure sim on requestAnimationFrame only while
 * something is moving, writes positions straight to the cell elements (no React
 * renders per frame), and goes fully idle once everything settles. With animation
 * off it places cells at rest and never starts a loop.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { AgentMapPacking } from "./agentMapLayout";
import {
  reconcileBodies,
  restFromPacking,
  snapToRest,
  stepCells,
  type RestMap,
  type SimState,
} from "./agentMapPhysics";

export function useAgentMapPhysics(packing: AgentMapPacking | null, animated: boolean) {
  const elements = useRef(new Map<string, HTMLElement>());
  const refCallbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const state = useRef<SimState>([]);
  const rest = useRef<RestMap | null>(null);
  const frame = useRef<number | null>(null);

  const restMap = useMemo(() => (packing === null ? null : restFromPacking(packing)), [packing]);

  const write = useCallback(() => {
    const bodies = state.current;
    const target = rest.current;
    if (target === null) return;
    let root: { x: number; y: number } | null = null;
    for (const body of bodies) if (target.get(body.id)?.root) root = body;
    for (const body of bodies) {
      const element = elements.current.get(body.id);
      if (!element) continue;
      element.style.transform = `translate3d(${body.x - body.r}px, ${body.y - body.r}px, 0)`;
      if (root === null || root === body) continue;
      // The tether and bud neck point from this cell to its parent's centre.
      element.style.setProperty("--tether-len", `${Math.hypot(root.x - body.x, root.y - body.y)}`);
      element.style.setProperty(
        "--tether-angle",
        `${Math.atan2(root.y - body.y, root.x - body.x)}rad`,
      );
    }
  }, []);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useLayoutEffect(() => {
    if (restMap === null) return;
    const previous = rest.current;
    rest.current = restMap;
    if (!animated) {
      stop();
      state.current = snapToRest(restMap);
      write();
      return;
    }
    state.current = reconcileBodies(state.current, restMap, previous);
    write();
    if (frame.current !== null) return;
    let last = performance.now();
    const tick = (now: number) => {
      const target = rest.current;
      if (target === null) return;
      const result = stepCells(state.current, target, now - last);
      last = now;
      state.current = result.state;
      write();
      frame.current = result.settled ? null : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [animated, restMap, stop, write]);

  useEffect(() => stop, [stop]);

  /** Stable ref callback per cell id, so React does not detach and reattach every render. */
  const attachCell = useCallback(
    (id: string) => {
      let callback = refCallbacks.current.get(id);
      if (!callback) {
        callback = (element: HTMLElement | null) => {
          if (element === null) {
            elements.current.delete(id);
            return;
          }
          elements.current.set(id, element);
          write();
        };
        refCallbacks.current.set(id, callback);
      }
      return callback;
    },
    [write],
  );

  return attachCell;
}
