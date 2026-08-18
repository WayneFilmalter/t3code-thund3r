import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createActionNode,
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createGateNode,
  createPromptBlockNode,
  createReviewNode,
  createStartNode,
  type WorkflowNode,
  type WorkflowRun,
} from "~/workflowsStore";

import {
  approveReview,
  attachThread,
  cancelRun,
  compileAgentPrompt,
  completeInstance,
  extractLastFencedJson,
  failInstance,
  instanceKeyFor,
  planRun,
  rejectReview,
  renderTemplate,
  runningThreads,
  shouldIterate,
  validateExpected,
  type RunnerEffect,
} from "./workflowRunner.logic";

const PROJECT_REF = scopeProjectRef(EnvironmentId.make("env-1"), ProjectId.make("project-1"));
const NOW = "2026-08-17T10:00:00.000Z";
const LATER = "2026-08-17T10:05:00.000Z";

function makeRun(nodes: WorkflowNode[], overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    definitionId: "def-1",
    name: "Backlog",
    color: "#22d3ee",
    projectRef: PROJECT_REF,
    snapshot: { sharedContext: "", nodes },
    status: "in-progress",
    iteration: 0,
    nextIterationAt: null,
    instances: {},
    review: null,
    result: null,
    startedAt: NOW,
    finishedAt: null,
    lastError: null,
    ...overrides,
  };
}

const thread = (id: string) => ({
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make(id),
  dispatchedAt: NOW,
  afterTurnId: null,
});

const startAgentEffects = (effects: RunnerEffect[]) =>
  effects.filter(
    (effect): effect is Extract<RunnerEffect, { type: "start-agent" }> =>
      effect.type === "start-agent",
  );

/** Drive one agent instance to completion with the given final message. */
function settle(run: WorkflowRun, key: string, text: string, threadId = key): WorkflowRun {
  const attached = attachThread(run, key, thread(threadId));
  return completeInstance(attached, key, { text, files: [], turnState: "completed" }, LATER);
}

describe("extractLastFencedJson / validateExpected", () => {
  it("parses the last fenced json block and falls back to text", () => {
    const text = 'Some prose\n```json\n{"a":1}\n```\nmore\n```json\n[1,2]\n```\n';
    expect(extractLastFencedJson(text)).toEqual({ kind: "json", value: [1, 2] });
    expect(extractLastFencedJson("no json here")).toEqual({ kind: "text", text: "no json here" });
    expect(extractLastFencedJson("```json\n{not json\n```")).toEqual({
      kind: "text",
      text: "```json\n{not json\n```",
    });
  });

  it("checks list and object expectations", () => {
    expect(validateExpected({ kind: "json", value: [] }, { kind: "list", hint: "" })).toBeNull();
    expect(validateExpected({ kind: "json", value: {} }, { kind: "list", hint: "" })).toMatch(
      /Expected a JSON list/,
    );
    expect(validateExpected({ kind: "text", text: "x" }, { kind: "object", hint: "" })).toMatch(
      /fenced/,
    );
    expect(validateExpected({ kind: "text", text: "x" }, { kind: "none", hint: "" })).toBeNull();
  });
});

describe("prompt compilation", () => {
  it("renders item paths, prev output and iteration", () => {
    const rendered = renderTemplate(
      "Do {{item.identifier}} ({{ item.title }}) #{{iteration}} after {{prev}}",
      {
        item: { identifier: "ABC-1", title: "Fix it" },
        prev: { kind: "text", text: "earlier" },
        iteration: 2,
      },
    );
    expect(rendered).toBe("Do ABC-1 (Fix it) #3 after earlier");
  });

  it("assembles skills, shared context, blocks, body, inputs and output instructions in order", () => {
    const node = createAgentNode("agent", {
      prompt: "Research it.",
      skills: ["review", "/tdd"],
      output: { kind: "object", hint: "{ ok: boolean }" },
    });
    const prompt = compileAgentPrompt({
      node,
      sharedContext: "Project rules.",
      promptBlocks: { before: ["Before block"], after: ["After block"] },
      vars: { item: { identifier: "ABC-2" }, prev: { kind: "json", value: [1] }, iteration: 0 },
      skills: node.skills,
    });
    const order = [
      "/review\n/tdd",
      "Project rules.",
      "Before block",
      "Research it.",
      "Item for this step:",
      '"identifier": "ABC-2"',
      "Input from the previous step:",
      "After block",
      "fenced ```json block containing a JSON object matching { ok: boolean }",
    ];
    let cursor = -1;
    for (const part of order) {
      const index = prompt.indexOf(part, cursor + 1);
      expect(index, part).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("does not repeat inputs the prompt already references and bakes presets", () => {
    const linear = createAgentNode("linear-agent", {
      preset: "find",
      prompt: "Find {{item}} tickets",
    });
    const prompt = compileAgentPrompt({
      node: linear,
      sharedContext: "",
      promptBlocks: { before: [], after: [] },
      vars: { item: "ten", iteration: 0 },
      skills: [],
    });
    expect(prompt).toContain("working with Linear");
    expect(prompt).toContain("Find ten tickets");
    expect(prompt).not.toContain("Item for this step");
    expect(prompt).toContain("a JSON array matching { id, identifier, title, url }[]");
    const action = createActionNode({ preset: "commit-pr" });
    expect(
      compileAgentPrompt({
        node: action,
        sharedContext: "",
        promptBlocks: { before: [], after: [] },
        vars: { iteration: 0 },
        skills: [],
      }),
    ).toContain("open a pull request");
  });
});

describe("planRun: linear chains", () => {
  it("runs start, agent, then a continued action on the same thread, then finishes", () => {
    const agent = createAgentNode("agent", { id: "a", prompt: "Build it" });
    const action = createActionNode({ id: "b", preset: "commit", session: "continue" });
    const end = createEndNode({ id: "e" });
    const start = createStartNode({ id: "s" });
    let run = makeRun([start, agent, action, end]);

    let plan = planRun(run, NOW);
    expect(plan.run.instances["s:0"]?.status).toBe("done");
    expect(plan.run.instances["a:0"]?.status).toBe("running");
    const [first] = startAgentEffects(plan.effects);
    expect(first?.request.session).toEqual({ kind: "new" });
    expect(first?.request.title).toBe("⟲ Backlog · Agent");
    expect(plan.effects).toHaveLength(1);

    // Idempotent while the agent runs.
    expect(planRun(plan.run, NOW).effects).toEqual([]);

    run = settle(plan.run, "a:0", "All built.");
    plan = planRun(run, LATER);
    const [second] = startAgentEffects(plan.effects);
    expect(second?.request.session).toMatchObject({
      kind: "continue",
      thread: { threadId: "a:0" },
    });
    expect(second?.request.prompt).toContain("Commit the work");
    expect(second?.request.prompt).toContain("Input from the previous step:\nAll built.");

    run = settle(plan.run, "b:0", "Committed as abc123.", "a:0");
    plan = planRun(run, LATER);
    // Report has no prompt: it takes the previous output as the result and the run is done.
    expect(plan.run.status).toBe("done");
    expect(plan.run.result).toBe("Committed as abc123.");
    expect(plan.effects).toEqual([{ type: "run-finished", status: "done" }]);
  });

  it("marks the run failed when an agent's output does not match its expectation", () => {
    const agent = createAgentNode("agent", {
      id: "a",
      prompt: "List",
      output: { kind: "list", hint: "" },
    });
    let run = makeRun([createStartNode({ id: "s" }), agent, createEndNode({ id: "e" })]);
    run = planRun(run, NOW).run;
    run = settle(run, "a:0", "Here you go, no json.");
    expect(run.instances["a:0"]?.status).toBe("failed");
    const plan = planRun(run, LATER);
    expect(plan.run.status).toBe("failed");
    expect(plan.run.lastError).toMatch(/fenced/);
  });

  it("uses context blocks for the next agent only", () => {
    const block = createPromptBlockNode({ id: "c", text: "Be terse.", placement: "before" });
    const agent = createAgentNode("agent", { id: "a", prompt: "Go" });
    const plan = planRun(
      makeRun([createStartNode({ id: "s" }), block, agent, createEndNode({ id: "e" })]),
      NOW,
    );
    expect(plan.run.instances["c:0"]?.status).toBe("done");
    expect(startAgentEffects(plan.effects)[0]?.request.prompt.startsWith("Be terse.\n\nGo")).toBe(
      true,
    );
  });
});

describe("planRun: fan-out", () => {
  const source = createAgentNode("linear-agent", { id: "find", prompt: "find" });
  const worker = createAgentNode("agent", { id: "work", prompt: "Handle {{item.id}}" });
  const fanOut = createFanOutNode({ id: "each", maxParallel: 2, lane: [worker] });
  const nodes = () => [createStartNode({ id: "s" }), source, fanOut, createEndNode({ id: "e" })];

  it("runs lanes up to maxParallel, then collects results into the fan-out output", () => {
    let run = planRun(makeRun(nodes()), NOW).run;
    run = settle(run, "find:0", '```json\n[{"id":1},{"id":2},{"id":3}]\n```');
    let plan = planRun(run, LATER);
    const started = startAgentEffects(plan.effects);
    expect(started.map((effect) => effect.request.instanceKey)).toEqual(["work:0:0", "work:0:1"]);
    expect(started[0]?.request.prompt).toContain("Handle 1");
    expect(started[0]?.request.title).toBe("⟲ Backlog · Agent · 1");
    expect(plan.run.instances["each:0"]?.status).toBe("running");
    expect(planRun(plan.run, LATER).effects).toEqual([]);

    run = settle(plan.run, "work:0:0", "done one");
    plan = planRun(run, LATER);
    expect(startAgentEffects(plan.effects).map((e) => e.request.instanceKey)).toEqual(["work:0:2"]);

    run = settle(plan.run, "work:0:1", "done two");
    run = settle(run, "work:0:2", "done three");
    plan = planRun(run, LATER);
    expect(plan.run.instances["each:0"]?.status).toBe("done");
    expect(plan.run.instances["each:0"]?.output).toEqual({
      kind: "json",
      value: [
        { item: { id: 1 }, output: "done one" },
        { item: { id: 2 }, output: "done two" },
        { item: { id: 3 }, output: "done three" },
      ],
    });
    expect(plan.run.status).toBe("done");
  });

  it("finishes with an empty list when the source has nothing", () => {
    let run = planRun(makeRun(nodes()), NOW).run;
    run = settle(run, "find:0", "```json\n[]\n```");
    const plan = planRun(run, LATER);
    expect(plan.run.instances["each:0"]?.status).toBe("done");
    expect(plan.run.status).toBe("done");
  });

  it("keeps other lanes going when one lane fails, and records the failure in the collection", () => {
    let run = planRun(makeRun(nodes()), NOW).run;
    run = settle(run, "find:0", '```json\n[{"id":1},{"id":2}]\n```');
    run = planRun(run, LATER).run;
    run = failInstance(run, "work:0:0", "boom", LATER);
    run = settle(run, "work:0:1", "ok");
    const plan = planRun(run, LATER);
    expect(plan.run.instances["each:0"]?.status).toBe("done");
    expect(plan.run.instances["each:0"]?.output).toEqual({
      kind: "json",
      value: [
        { item: { id: 1 }, error: "boom" },
        { item: { id: 2 }, output: "ok" },
      ],
    });
  });

  it("applies the lane env mode to lane agents", () => {
    const worktreeFanOut = createFanOutNode({
      id: "each",
      maxParallel: 1,
      laneEnvMode: "worktree",
      lane: [worker],
    });
    let run = planRun(
      makeRun([createStartNode({ id: "s" }), source, worktreeFanOut, createEndNode({ id: "e" })]),
      NOW,
    ).run;
    run = settle(run, "find:0", '```json\n[{"id":1}]\n```');
    const plan = planRun(run, LATER);
    expect(startAgentEffects(plan.effects)[0]?.request.envMode).toBe("worktree");
  });
});

describe("planRun: gate, review, loop, cancel", () => {
  it("retries a failed check on the same thread up to N times, then fails the run", () => {
    const agent = createAgentNode("agent", { id: "a", prompt: "Do" });
    const gate = createGateNode({
      id: "g",
      question: "Tests pass?",
      onFail: { kind: "retry", times: 1 },
    });
    let run = planRun(
      makeRun([createStartNode({ id: "s" }), agent, gate, createEndNode({ id: "e" })]),
      NOW,
    ).run;
    run = settle(run, "a:0", "done");
    let plan = planRun(run, LATER);
    let gateEffect = startAgentEffects(plan.effects)[0];
    expect(gateEffect?.request.instanceKey).toBe("g:0");
    expect(gateEffect?.request.session).toMatchObject({ kind: "continue" });
    expect(gateEffect?.request.prompt).toContain("Check: Tests pass?");

    run = settle(plan.run, "g:0", '```json\n{"verdict":"fail","reason":"3 failing"}\n```', "a:0");
    plan = planRun(run, LATER);
    gateEffect = startAgentEffects(plan.effects)[0];
    expect(gateEffect?.request.instanceKey).toBe("g:0");
    expect(gateEffect?.request.prompt).toContain("The previous check failed: 3 failing");
    expect(plan.run.instances["g:0"]?.attempt).toBe(1);

    run = settle(plan.run, "g:0", '```json\n{"verdict":"fail","reason":"still"}\n```', "a:0");
    plan = planRun(run, LATER);
    expect(plan.run.status).toBe("failed");
    expect(plan.run.lastError).toBe("Check failed: still");
  });

  it("pauses at a review and continues after approval, or cancels on rejection", () => {
    const agent = createAgentNode("agent", { id: "a", prompt: "Do" });
    const review = createReviewNode({ id: "r", instructions: "Look at the diff" });
    const after = createAgentNode("agent", { id: "b", prompt: "Ship" });
    let run = planRun(
      makeRun([createStartNode({ id: "s" }), agent, review, after, createEndNode({ id: "e" })]),
      NOW,
    ).run;
    run = settle(run, "a:0", "done");
    let plan = planRun(run, LATER);
    expect(plan.run.status).toBe("review");
    expect(plan.run.review).toEqual({ instanceKey: "r:0", summary: "Look at the diff" });
    expect(plan.effects).toEqual([{ type: "review-requested", instanceKey: "r:0" }]);
    expect(planRun(plan.run, LATER).effects).toEqual([]);

    const approved = planRun(approveReview(plan.run, LATER), LATER);
    expect(approved.run.instances["r:0"]?.status).toBe("done");
    expect(startAgentEffects(approved.effects)[0]?.request.instanceKey).toBe("b:0");

    const rejected = rejectReview(plan.run, LATER);
    expect(rejected.status).toBe("cancelled");
    expect(rejected.instances["r:0"]?.status).toBe("failed");
  });

  it("loops with fresh instances until the source is empty, arming a pause between iterations", () => {
    const start = createStartNode({
      id: "s",
      mode: "loop",
      maxIterations: 5,
      pauseSeconds: 60,
      doneWhen: "source-empty",
    });
    const find = createAgentNode("linear-agent", { id: "find", prompt: "find" });
    let run = planRun(makeRun([start, find, createEndNode({ id: "e" })]), NOW).run;
    run = settle(run, "find:0", '```json\n[{"id":1}]\n```');
    let plan = planRun(run, LATER);
    expect(shouldIterate(run)).toBe(true);
    expect(plan.run.iteration).toBe(1);
    expect(plan.run.status).toBe("in-progress");
    expect(plan.run.nextIterationAt).toBe("2026-08-17T10:06:00.000Z");
    expect(plan.effects).toEqual([{ type: "schedule-iteration", at: "2026-08-17T10:06:00.000Z" }]);
    // Before the pause elapses, planning only re-arms the timer.
    expect(planRun(plan.run, LATER).effects).toEqual([
      { type: "schedule-iteration", at: "2026-08-17T10:06:00.000Z" },
    ]);

    plan = planRun(plan.run, "2026-08-17T10:07:00.000Z");
    expect(plan.run.nextIterationAt).toBeNull();
    expect(startAgentEffects(plan.effects)[0]?.request.instanceKey).toBe("find:1");
    run = settle(plan.run, "find:1", "```json\n[]\n```");
    plan = planRun(run, "2026-08-17T10:08:00.000Z");
    expect(plan.run.status).toBe("done");
    expect(plan.run.iteration).toBe(1);
  });

  it("stops looping at maxIterations", () => {
    const start = createStartNode({
      id: "s",
      mode: "loop",
      maxIterations: 1,
      doneWhen: "max-only",
    });
    const agent = createAgentNode("agent", { id: "a", prompt: "go" });
    let run = planRun(makeRun([start, agent, createEndNode({ id: "e" })]), NOW).run;
    run = settle(run, "a:0", "ok");
    expect(planRun(run, LATER).run.status).toBe("done");
  });

  it("cancels running instances and lists their threads for interruption", () => {
    const agent = createAgentNode("agent", { id: "a", prompt: "go" });
    let run = planRun(
      makeRun([createStartNode({ id: "s" }), agent, createEndNode({ id: "e" })]),
      NOW,
    ).run;
    run = attachThread(run, "a:0", thread("t-1"));
    expect(runningThreads(run).map((entry) => entry.threadId)).toEqual(["t-1"]);
    const cancelled = cancelRun(run, LATER);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.instances["a:0"]?.status).toBe("skipped");
    expect(instanceKeyFor("x", 2, 3)).toBe("x:2:3");
  });
});
