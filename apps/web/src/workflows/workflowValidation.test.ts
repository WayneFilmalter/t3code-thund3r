import { describe, expect, it } from "vite-plus/test";

import {
  createActionNode,
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createGateNode,
  createStartNode,
  type WorkflowNode,
} from "~/workflowsStore";

import {
  canMoveNode,
  findNodeSlot,
  insertNode,
  moveNode,
  removeNode,
  updateNode,
} from "./graphEdits";
import { issuesByNode, validateWorkflow } from "./workflowValidation";

const messages = (nodes: WorkflowNode[], name = "Flow") =>
  validateWorkflow({ name, nodes }).map((issue) => issue.message);

describe("validateWorkflow", () => {
  it("accepts a single-prompt workflow and a fan-out fed by a list", () => {
    expect(
      messages([createStartNode(), createAgentNode("agent", { prompt: "go" }), createEndNode()]),
    ).toEqual([]);
    expect(
      messages([
        createStartNode(),
        createAgentNode("linear-agent", { prompt: "find them" }),
        createFanOutNode({ lane: [createAgentNode("agent", { prompt: "x" })] }),
        createEndNode(),
      ]),
    ).toEqual([]);
  });

  it("requires a name, one Start, one Report, and something to run", () => {
    expect(messages([createStartNode(), createEndNode()], "  ")).toEqual([
      "Name the workflow.",
      "Add at least one step, or give Report a prompt.",
    ]);
    expect(messages([createAgentNode("agent", { prompt: "x" })])).toContain(
      "Exactly one Start node.",
    );
    expect(messages([createAgentNode("agent", { prompt: "x" })])).toContain(
      "Exactly one Report node.",
    );
    expect(messages([createStartNode(), createEndNode({ reportPrompt: "Summarise" })])).toEqual([]);
  });

  it("flags empty prompts, orphaned continues, unfed fan-outs and empty lanes by node", () => {
    const empty = createAgentNode("agent", { id: "empty" });
    const orphan = createActionNode({ id: "orphan", session: "continue" });
    const gate = createGateNode({ id: "gate" });
    const fanOut = createFanOutNode({ id: "each" });
    const issues = issuesByNode(
      validateWorkflow({
        name: "Flow",
        nodes: [createStartNode(), orphan, gate, empty, fanOut, createEndNode()],
      }),
    );
    expect(issues.get("empty")).toEqual(["Give this agent a prompt."]);
    expect(issues.get("orphan")).toEqual([
      "Nothing to continue: no agent runs before this action in its chain.",
    ]);
    expect(issues.get("gate")?.[0]).toBe("Ask the check a question.");
    expect(issues.get("each")).toEqual([
      "For each needs a step before it whose output is a list.",
      "Add at least one step inside the lane.",
    ]);
  });

  it("rejects nested fan-outs and misplaced Start/Report", () => {
    const nested = createFanOutNode({
      id: "inner",
      lane: [createAgentNode("agent", { prompt: "x" })],
    });
    const issues = issuesByNode(
      validateWorkflow({
        name: "Flow",
        nodes: [
          createStartNode(),
          createAgentNode("linear-agent", { prompt: "find them" }),
          createFanOutNode({ id: "outer", lane: [nested] }),
          createEndNode({ id: "end" }),
          createAgentNode("agent", { id: "late", prompt: "x" }),
        ],
      }),
    );
    expect(issues.get("inner")?.[0]).toBe("For each cannot nest inside another lane.");
    expect(issues.get("end")).toEqual(["Report must be the last node."]);
  });
});

describe("graphEdits", () => {
  const start = createStartNode({ id: "s" });
  const a = createAgentNode("agent", { id: "a", prompt: "a" });
  const b = createAgentNode("agent", { id: "b", prompt: "b" });
  const lane = createAgentNode("agent", { id: "l", prompt: "l" });
  const each = createFanOutNode({ id: "each", lane: [lane] });
  const end = createEndNode({ id: "e" });
  const nodes: WorkflowNode[] = [start, a, each, b, end];
  const ids = (chain: readonly WorkflowNode[]) => chain.map((node) => node.id);

  it("finds slots at the top level and inside lanes", () => {
    expect(findNodeSlot(nodes, "b")).toEqual({ parentId: null, index: 3 });
    expect(findNodeSlot(nodes, "l")).toEqual({ parentId: "each", index: 0 });
    expect(findNodeSlot(nodes, "missing")).toBeNull();
  });

  it("inserts between Start and Report, clamping to keep them at the ends", () => {
    const fresh = createAgentNode("agent", { id: "n" });
    expect(ids(insertNode(nodes, { parentId: null, index: 0 }, fresh))).toEqual([
      "s",
      "n",
      "a",
      "each",
      "b",
      "e",
    ]);
    expect(ids(insertNode(nodes, { parentId: null, index: 99 }, fresh))).toEqual([
      "s",
      "a",
      "each",
      "b",
      "n",
      "e",
    ]);
    const inLane = insertNode(nodes, { parentId: "each", index: 1 }, fresh);
    expect(ids((inLane[2] as typeof each).lane)).toEqual(["l", "n"]);
  });

  it("removes and moves nodes within their chain only", () => {
    expect(ids(removeNode(nodes, "a"))).toEqual(["s", "each", "b", "e"]);
    expect(ids((removeNode(nodes, "l")[2] as typeof each).lane)).toEqual([]);
    expect(ids(moveNode(nodes, "b", -1))).toEqual(["s", "a", "b", "each", "e"]);
    expect(ids(moveNode(nodes, "a", -1))).toEqual(ids(nodes));
    expect(canMoveNode(nodes, "a", -1)).toBe(false);
    expect(canMoveNode(nodes, "a", 1)).toBe(true);
    expect(canMoveNode(nodes, "b", 1)).toBe(false);
  });

  it("updates nodes at any depth", () => {
    const updated = updateNode(nodes, "l", { prompt: "changed" });
    expect(((updated[2] as typeof each).lane[0] as typeof lane).prompt).toBe("changed");
    expect(nodes[2]).toBe(each);
  });
});
