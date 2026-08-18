/**
 * Pure edits on a workflow's node chain, including nodes nested in a fan-out lane. Every
 * function returns a new array and leaves the input untouched.
 */
import type { WorkflowNode } from "~/workflowsStore";

/** Where a node sits: at the top level (`parentId: null`) or inside a fan-out's lane. */
export interface NodeSlot {
  parentId: string | null;
  index: number;
}

export function findNodeSlot(nodes: readonly WorkflowNode[], nodeId: string): NodeSlot | null {
  const top = nodes.findIndex((node) => node.id === nodeId);
  if (top !== -1) return { parentId: null, index: top };
  for (const node of nodes) {
    if (node.kind !== "fan-out") continue;
    const inner = node.lane.findIndex((laneNode) => laneNode.id === nodeId);
    if (inner !== -1) return { parentId: node.id, index: inner };
  }
  return null;
}

function editChain(
  nodes: readonly WorkflowNode[],
  parentId: string | null,
  edit: (chain: readonly WorkflowNode[]) => WorkflowNode[],
): WorkflowNode[] {
  if (parentId === null) return edit(nodes);
  return nodes.map((node) =>
    node.kind === "fan-out" && node.id === parentId ? { ...node, lane: edit(node.lane) } : node,
  );
}

/** Insert `node` at `slot`; the top-level chain keeps Start first and Report last. */
export function insertNode(
  nodes: readonly WorkflowNode[],
  slot: NodeSlot,
  node: WorkflowNode,
): WorkflowNode[] {
  return editChain(nodes, slot.parentId, (chain) => {
    const lower = slot.parentId === null && chain[0]?.kind === "start" ? 1 : 0;
    const upper =
      slot.parentId === null && chain[chain.length - 1]?.kind === "end"
        ? chain.length - 1
        : chain.length;
    const index = Math.min(Math.max(slot.index, lower), upper);
    return [...chain.slice(0, index), node, ...chain.slice(index)];
  });
}

export function removeNode(nodes: readonly WorkflowNode[], nodeId: string): WorkflowNode[] {
  const slot = findNodeSlot(nodes, nodeId);
  if (!slot) return [...nodes];
  return editChain(nodes, slot.parentId, (chain) => chain.filter((node) => node.id !== nodeId));
}

/** Move a node one step up or down within its own chain, never past Start/Report. */
export function moveNode(
  nodes: readonly WorkflowNode[],
  nodeId: string,
  direction: -1 | 1,
): WorkflowNode[] {
  const slot = findNodeSlot(nodes, nodeId);
  if (!slot) return [...nodes];
  return editChain(nodes, slot.parentId, (chain) => {
    const target = slot.index + direction;
    if (target < 0 || target >= chain.length) return [...chain];
    const neighbour = chain[target]!;
    if (neighbour.kind === "start" || neighbour.kind === "end") return [...chain];
    const moving = chain[slot.index]!;
    if (moving.kind === "start" || moving.kind === "end") return [...chain];
    const next = [...chain];
    next[slot.index] = neighbour;
    next[target] = moving;
    return next;
  });
}

export function updateNode(
  nodes: readonly WorkflowNode[],
  nodeId: string,
  patch: Partial<WorkflowNode> | ((node: WorkflowNode) => WorkflowNode),
): WorkflowNode[] {
  const apply = (node: WorkflowNode): WorkflowNode =>
    node.id === nodeId
      ? typeof patch === "function"
        ? patch(node)
        : ({ ...node, ...(patch as object) } as WorkflowNode)
      : node;
  return nodes.map((node) => {
    const updated = apply(node);
    if (updated.kind === "fan-out" && updated.id !== nodeId) {
      return { ...updated, lane: updated.lane.map(apply) };
    }
    return updated;
  });
}

/** True when the node can be moved in `direction` (mirrors `moveNode`'s rules). */
export function canMoveNode(
  nodes: readonly WorkflowNode[],
  nodeId: string,
  direction: -1 | 1,
): boolean {
  const slot = findNodeSlot(nodes, nodeId);
  if (!slot) return false;
  const chain =
    slot.parentId === null
      ? nodes
      : ((nodes.find((node) => node.id === slot.parentId) as { lane?: WorkflowNode[] } | undefined)
          ?.lane ?? []);
  const moving = chain[slot.index];
  const neighbour = chain[slot.index + direction];
  if (!moving || !neighbour) return false;
  return (
    moving.kind !== "start" &&
    moving.kind !== "end" &&
    neighbour.kind !== "start" &&
    neighbour.kind !== "end"
  );
}
