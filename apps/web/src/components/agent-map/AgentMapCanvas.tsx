import { useState } from "react";

import type { AgentBubble, AgentMapModel } from "./agentMap.logic";
import { AgentCell } from "./AgentCell";
import type { AgentMapPacking } from "./agentMapLayout";
import { BLOOM_STAGGER_MS } from "./agentMapPhysics";
import { useAgentMapPhysics } from "./useAgentMapPhysics";

/**
 * The organism: cells positioned by the physics hook, floating in CSS. Children render
 * before the root so a budding cell emerges from under its parent's membrane.
 */
export function AgentMapCanvas(props: {
  readonly model: AgentMapModel;
  readonly packing: AgentMapPacking;
  readonly animated: boolean;
}) {
  const { model, packing } = props;
  const attachCell = useAgentMapPhysics(packing, props.animated);
  const bubbles = new Map<string, AgentBubble>(
    model.root.children.map((child) => [child.id, child]),
  );
  const dockedCount = packing.children.filter((cell) => cell.docked).length;

  // A child seen live that now docks squishes; one that first appears docked buds in.
  // Remembered across renders with the adjust-state-during-render pattern.
  const [seenLive, setSeenLive] = useState<ReadonlySet<string>>(() => new Set());
  // Cells present when the map opens bud out in turn, matching the physics hold.
  const [bloomOrder] = useState(
    () => new Map(packing.children.map((cell, index) => [cell.id, index] as const)),
  );
  const liveIds = packing.children.filter((cell) => !cell.docked).map((cell) => cell.id);
  if (liveIds.some((id) => !seenLive.has(id))) setSeenLive(new Set([...seenLive, ...liveIds]));

  return (
    <div
      className="relative size-full overflow-hidden"
      style={{ contain: "strict" }}
      data-animated={props.animated ? "true" : "false"}
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
  );
}
