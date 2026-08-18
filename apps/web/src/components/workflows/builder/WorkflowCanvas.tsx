import { PlusIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { NodeSlot } from "~/workflows/graphEdits";
import { WORKFLOW_NODE_META, type WorkflowPaletteItemId } from "~/workflows/workflowNodeMeta";
import type { WorkflowNode } from "~/workflowsStore";

import { FlowConnector } from "./FlowConnector";
import { NodeBubble, type NodeBubbleRunState } from "./NodeBubble";
import { NodePaletteMenu } from "./NodePaletteMenu";

export interface WorkflowCanvasProps {
  nodes: readonly WorkflowNode[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  /** Present in the builder; absent (read-only) in the run view. */
  onInsert?: ((slot: NodeSlot, item: WorkflowPaletteItemId) => void) | undefined;
  issuesByNode?: ReadonlyMap<string | null, string[]> | undefined;
  /** Run view: per-node instance state, keyed by node id. */
  runStateFor?: ((nodeId: string) => NodeBubbleRunState | undefined) | undefined;
  className?: string;
}

/**
 * Auto-laid-out flow: bubbles top-down joined by arrows, a fan-out's lane framed beneath it.
 * Pure CSS/flex — no measuring, no free-form positions — so it stays tidy in a narrow panel
 * and cheap to render.
 */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <div className={cn("flex w-full flex-col items-center px-3 py-4", props.className)}>
      <div className="flex w-full max-w-[440px] flex-col items-stretch">
        <Chain {...props} chain={props.nodes} parentId={null} />
      </div>
    </div>
  );
}

function Chain(
  props: WorkflowCanvasProps & { chain: readonly WorkflowNode[]; parentId: string | null },
) {
  const editable = props.onInsert !== undefined;
  const inLane = props.parentId !== null;
  return (
    <>
      {props.chain.map((node, index) => {
        const previous = props.chain[index - 1];
        const connectorAccent = previous
          ? WORKFLOW_NODE_META[previous.kind].accent
          : WORKFLOW_NODE_META[node.kind].accent;
        return (
          <div key={node.id} className="flex flex-col items-stretch">
            {index > 0 || inLane ? (
              <FlowConnector
                accent={connectorAccent}
                allowFanOut={!inLane}
                onInsert={
                  editable
                    ? (item) => props.onInsert!({ parentId: props.parentId, index }, item)
                    : undefined
                }
              />
            ) : null}
            <NodeBubble
              node={node}
              selected={props.selectedNodeId === node.id}
              issues={props.issuesByNode?.get(node.id)}
              runState={props.runStateFor?.(node.id)}
              onSelect={() => props.onSelect(node.id)}
            />
            {node.kind === "fan-out" ? <LaneFrame {...props} fanOut={node} /> : null}
          </div>
        );
      })}
      {inLane && editable && props.chain.length === 0 ? (
        <NodePaletteMenu
          allowFanOut={false}
          onPick={(item) => props.onInsert!({ parentId: props.parentId, index: 0 }, item)}
        >
          <button
            type="button"
            className="mx-auto mt-1 flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <PlusIcon className="size-3" />
            Add a step to the lane
          </button>
        </NodePaletteMenu>
      ) : null}
      {inLane && editable && props.chain.length > 0 ? (
        <FlowConnector
          accent={WORKFLOW_NODE_META[props.chain[props.chain.length - 1]!.kind].accent}
          allowFanOut={false}
          onInsert={(item) =>
            props.onInsert!({ parentId: props.parentId, index: props.chain.length }, item)
          }
        />
      ) : null}
    </>
  );
}

function LaneFrame(
  props: WorkflowCanvasProps & { fanOut: Extract<WorkflowNode, { kind: "fan-out" }> },
) {
  const accent = WORKFLOW_NODE_META["fan-out"].accent;
  const laneState = props.runStateFor?.(props.fanOut.id);
  return (
    <div
      className="relative ml-4 mt-2 rounded-2xl border border-dashed px-3 pb-3 pt-2"
      style={{ borderColor: accent }}
    >
      <div
        className="mb-1 flex items-center gap-2 text-[.68rem] uppercase tracking-wide"
        style={{ color: accent }}
      >
        <span>lane · per item</span>
        <span className="h-px flex-1" style={{ backgroundColor: accent, opacity: 0.4 }} />
        <span>
          {laneState?.laneProgress
            ? `${laneState.laneProgress.done}/${laneState.laneProgress.total} done`
            : `× ${props.fanOut.maxParallel} at once`}
        </span>
      </div>
      <div className="flex flex-col items-stretch">
        <Chain {...props} chain={props.fanOut.lane} parentId={props.fanOut.id} />
      </div>
    </div>
  );
}
