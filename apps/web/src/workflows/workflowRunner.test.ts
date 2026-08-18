import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createReviewNode,
  createStartNode,
  findWorkflowRun,
  useWorkflowsStore,
  type WorkflowDefinition,
  type WorkflowInstanceThread,
  type WorkflowNode,
} from "~/workflowsStore";

import { WorkflowRunner } from "./workflowRunner";
import type { HarvestedTurn, StartAgentRequest } from "./workflowRunner.logic";
import type { RunnerPorts, SettleResult } from "./workflowRunner.ports";

const PROJECT_REF = scopeProjectRef(EnvironmentId.make("env-1"), ProjectId.make("project-1"));

interface Pending {
  request: StartAgentRequest;
  thread: WorkflowInstanceThread;
  resolve: (result: SettleResult) => void;
}

/** In-memory ports: every started agent parks until the test settles it with a message. */
function fakePorts(options: { ready?: boolean } = {}) {
  let ready = options.ready ?? true;
  let counter = 0;
  const pending = new Map<string, Pending>();
  const settledResults = new Map<string, HarvestedTurn>();
  const readyListeners = new Set<() => void>();
  const interrupted: string[] = [];
  const timers: Array<{ delay: number; fire: () => void }> = [];
  const failNext: string[] = [];
  const ports: RunnerPorts = {
    startAgent: async (request) => {
      if (failNext.includes(request.instanceKey)) return { ok: false, error: "no provider" };
      counter += 1;
      const thread: WorkflowInstanceThread =
        request.session.kind === "continue"
          ? { ...request.session.thread, dispatchedAt: "now", afterTurnId: `turn-${counter - 1}` }
          : {
              environmentId: EnvironmentId.make("env-1"),
              threadId: ThreadId.make(`thread-${counter}`),
              dispatchedAt: "now",
              afterTurnId: null,
            };
      return { ok: true, thread };
    },
    waitForSettled: (thread, signal) =>
      new Promise<SettleResult>((resolve) => {
        const key = `${thread.threadId}#${pending.size}`;
        pending.set(key, { request: undefined as never, thread, resolve });
        signal.addEventListener("abort", () => {
          pending.delete(key);
          resolve({ kind: "aborted" });
        });
      }),
    harvest: async (thread) =>
      settledResults.get(thread.threadId) ?? { text: "", files: [], turnState: "completed" },
    interrupt: async (thread) => {
      interrupted.push(thread.threadId);
    },
    deleteThread: async () => {},
    isEnvironmentReady: () => ready,
    onEnvironmentReady: (_environmentId, callback) => {
      if (ready) {
        callback();
        return () => {};
      }
      readyListeners.add(callback);
      return () => readyListeners.delete(callback);
    },
    now: () => new Date().toISOString(),
    schedule: (delay, fire) => {
      const timer = { delay, fire };
      timers.push(timer);
      return () => {
        const index = timers.indexOf(timer);
        if (index !== -1) timers.splice(index, 1);
      };
    },
  };
  return {
    ports,
    interrupted,
    timers,
    failNext,
    setReady(next: boolean) {
      ready = next;
      if (next) {
        const listeners = [...readyListeners];
        readyListeners.clear();
        for (const listener of listeners) listener();
      }
    },
    /** Settle the oldest waiter for the thread with a final message. */
    settle(threadId: string, text: string, turnState: HarvestedTurn["turnState"] = "completed") {
      const entry = [...pending.entries()].find(([, value]) => value.thread.threadId === threadId);
      if (!entry) throw new Error(`no waiter for ${threadId}`);
      pending.delete(entry[0]);
      settledResults.set(ThreadId.make(threadId), { text, files: [], turnState });
      entry[1].resolve({ kind: "settled", turnState });
    },
    waiting: () => [...pending.values()].map((value) => value.thread.threadId),
  };
}

function definition(nodes: WorkflowNode[]): WorkflowDefinition {
  return {
    id: "def-1",
    name: "Flow",
    description: null,
    color: "#22d3ee",
    sharedContext: "",
    nodes,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    scheduledFor: null,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const readRun = (runId: string) =>
  findWorkflowRun(useWorkflowsStore.getState().byProjectKey, runId)!;

describe("WorkflowRunner", () => {
  beforeEach(() => useWorkflowsStore.setState({ byProjectKey: {} }));

  it("drives a linear workflow to done, continuing the thread for the action", async () => {
    const fake = fakePorts();
    const runner = new WorkflowRunner(fake.ports);
    const nodes = [
      createStartNode({ id: "s" }),
      createAgentNode("agent", { id: "a", prompt: "Build" }),
      createAgentNode("agent", { id: "b", prompt: "Test", session: "continue" }),
      createEndNode({ id: "e" }),
    ];
    const run = runner.startRun(PROJECT_REF, definition(nodes))!;
    await flush();
    expect(readRun(run.id).instances["a:0"]).toMatchObject({
      status: "running",
      thread: { threadId: "thread-1" },
    });
    expect(fake.waiting()).toEqual(["thread-1"]);

    fake.settle("thread-1", "Built.");
    await flush();
    await flush();
    expect(readRun(run.id).instances["a:0"]?.status).toBe("done");
    expect(readRun(run.id).instances["b:0"]).toMatchObject({
      status: "running",
      thread: { threadId: "thread-1" },
    });

    fake.settle("thread-1", "Tested.");
    await flush();
    await flush();
    const finished = readRun(run.id);
    expect(finished.status).toBe("done");
    expect(finished.result).toBe("Tested.");
  });

  it("refuses to start an invalid definition", () => {
    const runner = new WorkflowRunner(fakePorts().ports);
    expect(runner.startRun(PROJECT_REF, definition([createStartNode()]))).toBeNull();
  });

  it("fails an instance whose dispatch fails and marks the run failed", async () => {
    const fake = fakePorts();
    fake.failNext.push("a:0");
    const runner = new WorkflowRunner(fake.ports);
    const run = runner.startRun(
      PROJECT_REF,
      definition([
        createStartNode({ id: "s" }),
        createAgentNode("agent", { id: "a", prompt: "x" }),
        createEndNode({ id: "e" }),
      ]),
    )!;
    await flush();
    await flush();
    expect(readRun(run.id).status).toBe("failed");
    expect(readRun(run.id).lastError).toBe("no provider");
  });

  it("reconciles on start: re-watches running threads and fails instances that never dispatched", async () => {
    const fake = fakePorts();
    // Simulate a persisted run mid-flight: agent a has a thread, agent b never got one.
    const nodes: WorkflowNode[] = [
      createStartNode({ id: "s" }),
      createFanOutNode({
        id: "each",
        maxParallel: 2,
        lane: [createAgentNode("agent", { id: "w", prompt: "{{item}}" })],
      }),
      createEndNode({ id: "e" }),
    ];
    const source = createAgentNode("linear-agent", { id: "find", prompt: "find" });
    nodes.splice(1, 0, source);
    const store = useWorkflowsStore.getState();
    const run = store.createRun(PROJECT_REF, definition(nodes));
    store.patchRun(run.id, (current) => ({
      ...current,
      instances: {
        "s:0": { key: "s:0", nodeId: "s", iteration: 0, status: "done" },
        "find:0": {
          key: "find:0",
          nodeId: "find",
          iteration: 0,
          status: "done",
          output: { kind: "json", value: ["one", "two"] },
        },
        "each:0": { key: "each:0", nodeId: "each", iteration: 0, status: "running" },
        "w:0:0": {
          key: "w:0:0",
          nodeId: "w",
          iteration: 0,
          index: 0,
          status: "running",
          thread: {
            environmentId: EnvironmentId.make("env-1"),
            threadId: ThreadId.make("old-thread"),
            dispatchedAt: "then",
            afterTurnId: null,
          },
        },
        "w:0:1": { key: "w:0:1", nodeId: "w", iteration: 0, index: 1, status: "running" },
      },
    }));

    const runner = new WorkflowRunner(fake.ports);
    runner.start();
    await flush();
    await flush();
    const after = readRun(run.id);
    expect(after.instances["w:0:1"]).toMatchObject({ status: "failed" });
    expect(fake.waiting()).toEqual(["old-thread"]);

    fake.settle("old-thread", "lane one done");
    await flush();
    await flush();
    const done = readRun(run.id);
    expect(done.instances["each:0"]?.status).toBe("done");
    expect(done.status).toBe("done");
  });

  it("defers planning until the environment is ready", async () => {
    const fake = fakePorts({ ready: false });
    const runner = new WorkflowRunner(fake.ports);
    const run = runner.startRun(
      PROJECT_REF,
      definition([
        createStartNode({ id: "s" }),
        createAgentNode("agent", { id: "a", prompt: "x" }),
        createEndNode({ id: "e" }),
      ]),
    )!;
    await flush();
    expect(readRun(run.id).instances["a:0"]).toBeUndefined();
    fake.setReady(true);
    await flush();
    await flush();
    expect(readRun(run.id).instances["a:0"]?.status).toBe("running");
  });

  it("stops a run: interrupts running threads and cancels waiters", async () => {
    const fake = fakePorts();
    const runner = new WorkflowRunner(fake.ports);
    const run = runner.startRun(
      PROJECT_REF,
      definition([
        createStartNode({ id: "s" }),
        createAgentNode("agent", { id: "a", prompt: "x" }),
        createEndNode({ id: "e" }),
      ]),
    )!;
    await flush();
    runner.cancelRun(run.id);
    await flush();
    expect(readRun(run.id).status).toBe("cancelled");
    expect(fake.interrupted).toEqual(["thread-1"]);
    expect(fake.waiting()).toEqual([]);
  });

  it("pauses for review and resumes on approval; arms the loop timer between iterations", async () => {
    const fake = fakePorts();
    const runner = new WorkflowRunner(fake.ports);
    const run = runner.startRun(
      PROJECT_REF,
      definition([
        createStartNode({
          id: "s",
          mode: "loop",
          maxIterations: 2,
          pauseSeconds: 30,
          doneWhen: "max-only",
        }),
        createAgentNode("agent", { id: "a", prompt: "x" }),
        createReviewNode({ id: "r" }),
        createEndNode({ id: "e" }),
      ]),
    )!;
    await flush();
    fake.settle("thread-1", "first");
    await flush();
    await flush();
    expect(readRun(run.id).status).toBe("review");
    runner.approveReview(run.id);
    await flush();
    const looped = readRun(run.id);
    expect(looped.iteration).toBe(1);
    expect(looped.status).toBe("in-progress");
    expect(fake.timers).toHaveLength(1);
    fake.timers[0]!.fire();
    await flush();
    await flush();
    expect(readRun(run.id).instances["a:1"]?.status).toBe("running");
  });
});
