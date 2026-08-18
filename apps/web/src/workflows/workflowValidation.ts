/**
 * Pure structural checks the builder runs before Save and the runner runs before Start.
 * Every issue points at a node so the canvas can glow the offending bubble red.
 */
import type { WorkflowDefinition, WorkflowNode } from "~/workflowsStore";

import { isAgentTurnNode } from "./workflowNodeMeta";

export interface WorkflowIssue {
  nodeId: string | null;
  message: string;
}

/** True when the node yields a list the next node can fan out over. */
function producesList(node: WorkflowNode): boolean {
  if (node.kind === "fan-out") return true;
  if (node.kind === "agent" || node.kind === "linear-agent") return node.output.kind === "list";
  return false;
}

/** The nearest previous node in the chain that runs on a thread, skipping context blocks. */
function previousExecutingNode(chain: readonly WorkflowNode[], index: number): WorkflowNode | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = chain[cursor]!;
    if (candidate.kind === "prompt-block") continue;
    return candidate;
  }
  return null;
}

function validateChain(
  chain: readonly WorkflowNode[],
  issues: WorkflowIssue[],
  scope: "top" | "lane",
): void {
  chain.forEach((node, index) => {
    switch (node.kind) {
      case "start":
        if (scope === "lane" || index !== 0) {
          issues.push({ nodeId: node.id, message: "Start must be the first node." });
        }
        if (node.mode === "loop" && node.maxIterations < 1) {
          issues.push({ nodeId: node.id, message: "Loop needs at least one iteration." });
        }
        break;
      case "end":
        if (scope === "lane" || index !== chain.length - 1) {
          issues.push({ nodeId: node.id, message: "Report must be the last node." });
        }
        break;
      case "agent":
      case "linear-agent":
        if (!node.prompt.trim()) {
          issues.push({ nodeId: node.id, message: "Give this agent a prompt." });
        }
        if (node.session === "continue" && !hasThreadBefore(chain, index)) {
          issues.push({
            nodeId: node.id,
            message: "Nothing to continue: no agent runs before this node in its chain.",
          });
        }
        break;
      case "action":
        if (node.preset === "custom" && !node.prompt.trim()) {
          issues.push({ nodeId: node.id, message: "Describe the custom action." });
        }
        if (node.session === "continue" && !hasThreadBefore(chain, index)) {
          issues.push({
            nodeId: node.id,
            message: "Nothing to continue: no agent runs before this action in its chain.",
          });
        }
        break;
      case "gate":
        if (!node.question.trim()) {
          issues.push({ nodeId: node.id, message: "Ask the check a question." });
        }
        if (previousExecutingNode(chain, index) === null || index === 0) {
          issues.push({ nodeId: node.id, message: "A check needs a step before it." });
        }
        break;
      case "fan-out": {
        if (scope === "lane") {
          issues.push({ nodeId: node.id, message: "For each cannot nest inside another lane." });
        }
        const source = previousExecutingNode(chain, index);
        if (!source || !producesList(source)) {
          issues.push({
            nodeId: node.id,
            message: "For each needs a step before it whose output is a list.",
          });
        }
        if (node.lane.length === 0) {
          issues.push({ nodeId: node.id, message: "Add at least one step inside the lane." });
        }
        if (node.maxParallel < 1) {
          issues.push({ nodeId: node.id, message: "Run at least one lane at a time." });
        }
        validateChain(node.lane, issues, "lane");
        break;
      }
      case "review":
      case "prompt-block":
        break;
    }
  });
}

/** True when some node before `index` in the chain runs on a thread the next node can continue. */
function hasThreadBefore(chain: readonly WorkflowNode[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = chain[cursor]!;
    if (candidate.kind === "fan-out" || candidate.kind === "review") return false;
    if (isAgentTurnNode(candidate) && candidate.kind !== "end") return true;
  }
  return false;
}

export function validateWorkflow(
  definition: Pick<WorkflowDefinition, "name" | "nodes">,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (!definition.name.trim()) issues.push({ nodeId: null, message: "Name the workflow." });
  const starts = definition.nodes.filter((node) => node.kind === "start");
  const ends = definition.nodes.filter((node) => node.kind === "end");
  if (starts.length !== 1) issues.push({ nodeId: null, message: "Exactly one Start node." });
  if (ends.length !== 1) issues.push({ nodeId: null, message: "Exactly one Report node." });
  const executing = definition.nodes.filter(
    (node) => node.kind !== "start" && node.kind !== "end" && node.kind !== "prompt-block",
  );
  if (executing.length === 0 && !ends[0]?.reportPrompt.trim()) {
    issues.push({ nodeId: null, message: "Add at least one step, or give Report a prompt." });
  }
  validateChain(definition.nodes, issues, "top");
  return issues;
}

/** Issues grouped by node id, for the canvas to glow bubbles; `null` keys are workflow-level. */
export function issuesByNode(issues: readonly WorkflowIssue[]): Map<string | null, string[]> {
  const byNode = new Map<string | null, string[]>();
  for (const issue of issues) {
    const list = byNode.get(issue.nodeId) ?? [];
    list.push(issue.message);
    byNode.set(issue.nodeId, list);
  }
  return byNode;
}
