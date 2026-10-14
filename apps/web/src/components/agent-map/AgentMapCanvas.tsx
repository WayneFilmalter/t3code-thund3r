import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";

import type { AgentBubble, AgentMapModel } from "./agentMap.logic";
import { AgentCell } from "./AgentCell";
import { fitScale, type AgentMapPacking } from "./agentMapLayout";
import { BLOOM_STAGGER_MS } from "./agentMapPhysics";
import { useAgentMapPhysics } from "./useAgentMapPhysics";

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 4;
const BUTTON_ZOOM_STEP = 1.25;

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const HOME_VIEW: View = { zoom: 1, panX: 0, panY: 0 };

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Zooming by `factor` around a point (in box coordinates) keeps that point still:
 * the stage origin moves so the world point under it maps back to the same spot.
 */
export function zoomAround(
  view: View,
  factor: number,
  point: { x: number; y: number },
  box: { width: number; height: number },
): View {
  const zoom = clampZoom(view.zoom * factor);
  const ratio = zoom / view.zoom;
  const fromCentreX = point.x - box.width / 2;
  const fromCentreY = point.y - box.height / 2;
  return {
    zoom,
    panX: fromCentreX - (fromCentreX - view.panX) * ratio,
    panY: fromCentreY - (fromCentreY - view.panY) * ratio,
  };
}

/**
 * The organism. The stage is scaled to fit the box (so the cluster grows and shrinks
 * with its space) times the user's zoom, and panned by dragging. View changes write the
 * stage transform directly; React only re-renders for the zoom label.
 *
 * Children render before the root so a budding cell emerges from under its parent.
 */
export function AgentMapCanvas(props: {
  readonly model: AgentMapModel;
  readonly packing: AgentMapPacking;
  readonly animated: boolean;
  readonly width: number;
  readonly height: number;
}) {
  const { model, packing, width, height, animated } = props;
  const attachCell = useAgentMapPhysics(packing, animated);
  const bubbles = new Map<string, AgentBubble>(
    model.root.children.map((child) => [child.id, child]),
  );
  const dockedCount = packing.children.filter((cell) => cell.docked).length;

  // A child seen live that now docks squishes; one that first appears docked buds in.
  // Remembered across renders with the adjust-state-during-render pattern.
  const [seenLive, setSeenLive] = useState<ReadonlySet<string>>(() => new Set());
  const liveIds = packing.children.filter((cell) => !cell.docked).map((cell) => cell.id);
  if (liveIds.some((id) => !seenLive.has(id))) setSeenLive(new Set([...seenLive, ...liveIds]));
  // Cells present when the map opens bud out in turn, matching the physics hold.
  const [bloomOrder] = useState(
    () => new Map(packing.children.map((cell, index) => [cell.id, index] as const)),
  );

  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const view = useRef<View>(HOME_VIEW);
  const [zoomPercent, setZoomPercent] = useState(100);
  const fit = fitScale(packing.extent, { width, height });

  const applyView = useCallback(
    (next: View, smooth: boolean) => {
      view.current = next;
      const element = stage.current;
      if (element) {
        element.style.transition = smooth && animated ? "transform 220ms ease-out" : "none";
        element.style.transform = `translate(${width / 2 + next.panX}px, ${height / 2 + next.panY}px) scale(${fit * next.zoom})`;
      }
      setZoomPercent(Math.round(next.zoom * 100));
    },
    [animated, fit, height, width],
  );

  // Resizes and repacks glide the stage to its new fit.
  useLayoutEffect(() => applyView(view.current, true), [applyView]);

  // Scrolling zooms at the pointer; dragging pans. Pinch arrives as ctrl+wheel with small
  // deltas, so it gets a stronger factor. Line-mode wheels (Firefox) report in lines.
  useEffect(() => {
    if (box === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002));
      applyView(
        zoomAround(
          view.current,
          factor,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          rect,
        ),
        false,
      );
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [applyView, box]);

  const drag = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(
    null,
  );
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: view.current.panX,
      panY: view.current.panY,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      if (Math.hypot(dx, dy) < 3) return;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    applyView({ ...view.current, panX: start.panX + dx, panY: start.panY + dy }, false);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const zoomBy = (factor: number) =>
    applyView(
      zoomAround(view.current, factor, { x: width / 2, y: height / 2 }, { width, height }),
      true,
    );

  return (
    <div
      ref={setBox}
      className="relative size-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      style={{ contain: "strict" }}
      data-animated={animated ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => applyView(HOME_VIEW, true)}
    >
      <div
        ref={stage}
        className="absolute top-0 left-0 size-0 origin-top-left"
        role="img"
        aria-label={`${model.root.name}, ${model.root.status}, ${packing.children.length} subagents`}
      >
        {packing.children.map((cell) => {
          const bubble = bubbles.get(cell.id);
          if (!bubble) return null;
          const returned = cell.docked && seenLive.has(cell.id);
          return (
            <AgentCell
              key={cell.id}
              cell={cell}
              bubble={bubble}
              attach={attachCell(cell.id)}
              pulseKey={cell.docked ? "docked" : "live"}
              pulse={returned ? "squish" : "bud"}
              budDelayMs={(bloomOrder.get(cell.id) ?? 0) * BLOOM_STAGGER_MS}
            />
          );
        })}
        <AgentCell
          cell={packing.root}
          bubble={model.root}
          attach={attachCell(packing.root.id)}
          pulseKey={`docked:${dockedCount}`}
          pulse={dockedCount > 0 ? "squish" : null}
          budDelayMs={0}
        />
      </div>
      <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-md border border-border bg-background/80 p-0.5 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / BUTTON_ZOOM_STEP)}
        >
          <MinusIcon />
        </Button>
        <Button
          variant="ghost"
          size="compact"
          aria-label="Fit the map to the panel"
          onClick={() => applyView(HOME_VIEW, true)}
        >
          <ScanIcon />
          <span className="tabular-nums">{zoomPercent}%</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom in"
          onClick={() => zoomBy(BUTTON_ZOOM_STEP)}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}
