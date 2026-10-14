import { describe, expect, it } from "vite-plus/test";

import { buildWorkflowAuthoringPrompt, parseWorkflowDraft } from "./workflowAuthoring";
import { extractLastFencedJson } from "./workflowRunner.logic";
import { validateWorkflow } from "./workflowValidation";

describe("buildWorkflowAuthoringPrompt", () => {
  it("teaches every node kind and asks for a fenced json block", () => {
    const prompt = buildWorkflowAuthoringPrompt("Triage the backlog");
    for (const kind of ["start", "agent", "linear-agent", "fan-out", "gate", "review", "action"]) {
      expect(prompt).toContain(`"kind": "${kind}"`);
    }
    expect(prompt).toContain("Triage the backlog");
    expect(prompt).toContain("```json");
  });
});

describe("parseWorkflowDraft", () => {
  it("builds a valid definition from a realistic draft, filling defaults and fresh ids", () => {
    const reply = `Here is the workflow.

\`\`\`json
{
  "name": "Ship tagged tickets",
  "description": "Implement 5 tickets",
  "color": "#34d399",
  "sharedContext": "Follow AGENTS.md.",
  "nodes": [
    { "kind": "start", "mode": "loop", "maxIterations": 3 },
    { "kind": "linear-agent", "title": "Find", "preset": "find", "prompt": "Find 5 tickets" },
    { "kind": "fan-out", "maxParallel": 2, "laneEnvMode": "worktree", "lane": [
      { "kind": "agent", "title": "Plan", "prompt": "Plan {{item.identifier}}", "interactionMode": "plan", "bogus": 1 },
      { "kind": "agent", "title": "Implement", "prompt": "Do it", "session": "continue", "output": { "kind": "object", "hint": "{ ok }" } },
      { "kind": "action", "preset": "commit-pr" },
      { "kind": "context", "text": "Be brief.", "placement": "after" },
      { "kind": "gate", "question": "Did it pass?", "onFail": { "kind": "retry", "times": 3 } }
    ] },
    { "kind": "review", "instructions": "Check the PRs" },
    { "kind": "end", "format": "caveman", "reportPrompt": "PR links." }
  ]
}
\`\`\``;
    const result = parseWorkflowDraft(extractLastFencedJson(reply));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { input } = result;
    expect(input).toMatchObject({
      name: "Ship tagged tickets",
      description: "Implement 5 tickets",
      color: "#34d399",
      sharedContext: "Follow AGENTS.md.",
    });
    const nodes = input.nodes!;
    expect(nodes.map((node) => node.kind)).toEqual([
      "start",
      "linear-agent",
      "fan-out",
      "review",
      "end",
    ]);
    expect(nodes[0]).toMatchObject({ mode: "loop", maxIterations: 3, doneWhen: "source-empty" });
    expect(nodes[1]).toMatchObject({ preset: "find", output: { kind: "list" } });
    const fanOut = nodes[2]!;
    if (fanOut.kind !== "fan-out") throw new Error("expected fan-out");
    expect(fanOut).toMatchObject({ maxParallel: 2, laneEnvMode: "worktree" });
    expect(fanOut.lane.map((node) => node.kind)).toEqual([
      "agent",
      "agent",
      "action",
      "prompt-block",
      "gate",
    ]);
    expect(fanOut.lane[0]).toMatchObject({ interactionMode: "plan", runtimeMode: "full-access" });
    expect(fanOut.lane[0]).not.toHaveProperty("bogus");
    expect(fanOut.lane[1]).toMatchObject({ session: "continue", output: { kind: "object" } });
    expect(fanOut.lane[3]).toMatchObject({ text: "Be brief.", placement: "after" });
    expect(fanOut.lane[4]).toMatchObject({ onFail: { kind: "retry", times: 3 } });
    expect(nodes[4]).toMatchObject({ format: "caveman", reportPrompt: "PR links." });
    const ids = new Set<string>();
    for (const node of nodes) {
      ids.add(node.id);
      if (node.kind === "fan-out") for (const inner of node.lane) ids.add(inner.id);
    }
    expect(ids.size).toBe(10);
    expect(validateWorkflow({ name: input.name, nodes })).toEqual([]);
  });

  it("coerces unknown enum values to defaults and wraps missing Start/Report", () => {
    const result = parseWorkflowDraft({
      kind: "json",
      value: {
        name: "  ",
        nodes: [
          { kind: "end", format: "verbose" },
          { kind: "agent", prompt: "Go", session: "forever", envMode: "cloud", output: "list" },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.name).toBe("New workflow");
    expect(result.input.nodes!.map((node) => node.kind)).toEqual(["start", "agent", "end"]);
    expect(result.input.nodes![1]).toMatchObject({
      prompt: "Go",
      session: "new",
      envMode: "default",
      output: { kind: "none" },
    });
    expect(result.input.nodes![2]).toMatchObject({ format: "summary" });
  });

  it("rejects text-only replies, non-objects, and unknown step kinds", () => {
    expect(parseWorkflowDraft({ kind: "text", text: "I could not." })).toMatchObject({
      ok: false,
      error: expect.stringContaining("fenced"),
    });
    expect(parseWorkflowDraft({ kind: "json", value: [1] })).toMatchObject({ ok: false });
    expect(
      parseWorkflowDraft({
        kind: "json",
        value: { name: "x", nodes: [{ kind: "webhook" }, { kind: "agent", prompt: "x" }] },
      }),
    ).toEqual({ ok: false, error: "Unknown step kind: webhook." });
    expect(
      parseWorkflowDraft({
        kind: "json",
        value: { name: "x", nodes: [{ kind: "fan-out", lane: [{ kind: "fan-out", lane: [] }] }] },
      }),
    ).toEqual({ ok: false, error: "Unknown step kind: fan-out inside a lane." });
  });
});
