/**
 * The client-side workflow runner: steps runs with `planRun`, performs the effects through
 * `RunnerPorts`, and folds results back into the store. Ticks are serialized per run so a
 * settle and a timer never plan the same run twice at once. On start it reconciles every
 * unfinished run against live thread state so a reload or reconnect resumes where it left off.
 *
 * Runs advance only while a web client is open; the agents themselves run on the server.
 */
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

import {
  findWorkflowRun,
  selectActiveWorkflowRuns,
  useWorkflowsStore,
  type WorkflowDefinition,
  type WorkflowInstanceThread,
  type WorkflowRun,
} from "~/workflowsStore";

import {
  approveReview as approveReviewLogic,
  attachThread,
  cancelRun as cancelRunLogic,
  completeInstance,
  failInstance,
  pauseRun as pauseRunLogic,
  planRun,
  rejectReview as rejectReviewLogic,
  resumeRun as resumeRunLogic,
  runningThreads,
  type StartAgentRequest,
} from "./workflowRunner.logic";
import type { RunnerPorts } from "./workflowRunner.ports";
import { validateWorkflow } from "./workflowValidation";

type Store = typeof useWorkflowsStore;

export class WorkflowRunner {
  private readonly ticks = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, AbortController>();
  private readonly timers = new Map<string, { at: string; cancel: () => void }>();
  private readonly deferred = new Map<string, () => void>();
  private started = false;

  constructor(
    private readonly ports: RunnerPorts,
    private readonly store: Store = useWorkflowsStore,
  ) {}

  /** Reconcile persisted runs against live threads, then keep stepping them. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const run of selectActiveWorkflowRuns(this.store.getState().byProjectKey)) {
      this.reconcile(run);
    }
  }

  stop(): void {
    this.started = false;
    for (const controller of this.waiters.values()) controller.abort();
    this.waiters.clear();
    for (const timer of this.timers.values()) timer.cancel();
    this.timers.clear();
    for (const cancel of this.deferred.values()) cancel();
    this.deferred.clear();
  }

  /** Validate and start a run of the definition; returns null when the definition is invalid. */
  startRun(ref: ScopedProjectRef, definition: WorkflowDefinition): WorkflowRun | null {
    if (validateWorkflow(definition).length > 0) return null;
    const run = this.store.getState().createRun(ref, definition);
    this.tick(run.id);
    return run;
  }

  cancelRun(runId: string): void {
    const run = this.readRun(runId);
    if (!run) return;
    const threads = runningThreads(run);
    for (const [key, controller] of this.waiters) {
      if (key.startsWith(`${runId}/`)) {
        controller.abort();
        this.waiters.delete(key);
      }
    }
    this.clearTimer(runId);
    this.write(runId, (current) => cancelRunLogic(current, this.ports.now()));
    for (const thread of threads) void this.ports.interrupt(thread);
    this.store.getState().pruneRuns(run.projectRef);
  }

  pauseRun(runId: string): void {
    this.clearTimer(runId);
    this.write(runId, (current) => pauseRunLogic(current, this.ports.now()));
  }

  resumeRun(runId: string): void {
    this.write(runId, (current) => resumeRunLogic(current));
    this.tick(runId);
  }

  /** Start a fresh run of the same graph a stuck run used; returns the new run. */
  restartRun(runId: string): WorkflowRun | null {
    const run = this.readRun(runId);
    if (!run) return null;
    const definition: WorkflowDefinition = {
      id: run.definitionId,
      name: run.name,
      description: null,
      color: run.color,
      sharedContext: run.snapshot.sharedContext,
      nodes: run.snapshot.nodes,
      createdAt: run.startedAt,
      updatedAt: run.startedAt,
      scheduledFor: null,
    };
    return this.startRun(run.projectRef, definition);
  }

  approveReview(runId: string): void {
    this.write(runId, (current) => approveReviewLogic(current, this.ports.now()));
    this.tick(runId);
  }

  rejectReview(runId: string): void {
    const run = this.readRun(runId);
    if (!run) return;
    this.write(runId, (current) => rejectReviewLogic(current, this.ports.now()));
    this.store.getState().pruneRuns(run.projectRef);
  }

  /** Serialized planning pass for one run. Safe to call from anywhere, any number of times. */
  tick(runId: string): Promise<void> {
    const previous = this.ticks.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.tickNow(runId))
      .catch((error: unknown) => {
        console.error("[workflow-runner] tick failed", error);
      });
    this.ticks.set(runId, next);
    void next.then(() => {
      if (this.ticks.get(runId) === next) this.ticks.delete(runId);
    });
    return next;
  }

  private tickNow(runId: string): void {
    const run = this.readRun(runId);
    if (!run) return;
    if (run.status !== "in-progress") return;
    const environmentId = run.projectRef.environmentId;
    if (!this.ports.isEnvironmentReady(environmentId)) {
      this.deferUntilReady(runId, environmentId);
      return;
    }
    const { run: next, effects } = planRun(run, this.ports.now());
    if (next !== run) this.store.getState().patchRun(runId, () => next);
    for (const effect of effects) {
      switch (effect.type) {
        case "start-agent":
          void this.dispatchAgent(runId, effect.request);
          break;
        case "schedule-iteration":
          this.armTimer(runId, effect.at);
          break;
        case "run-finished":
          this.clearTimer(runId);
          this.store.getState().pruneRuns(next.projectRef);
          break;
        case "review-requested":
          break;
      }
    }
  }

  private async dispatchAgent(runId: string, request: StartAgentRequest): Promise<void> {
    const run = this.readRun(runId);
    if (!run || run.status !== "in-progress") return;
    const result = await this.ports.startAgent(request, run.projectRef);
    if (!result.ok) {
      this.write(runId, (current) =>
        failInstance(current, request.instanceKey, result.error, this.ports.now()),
      );
      void this.tick(runId);
      return;
    }
    this.write(runId, (current) => attachThread(current, request.instanceKey, result.thread));
    await this.watch(runId, request.instanceKey, result.thread);
  }

  /** Wait for the instance's turn to settle, harvest it, and re-tick. */
  private async watch(runId: string, instanceKey: string, thread: WorkflowInstanceThread) {
    const waiterKey = `${runId}/${instanceKey}`;
    this.waiters.get(waiterKey)?.abort();
    const controller = new AbortController();
    this.waiters.set(waiterKey, controller);
    const settled = await this.ports.waitForSettled(thread, controller.signal);
    if (this.waiters.get(waiterKey) === controller) this.waiters.delete(waiterKey);
    if (settled.kind === "aborted") return;
    if (settled.kind === "deleted") {
      this.write(runId, (current) =>
        failInstance(current, instanceKey, "The agent's thread was deleted.", this.ports.now()),
      );
      void this.tick(runId);
      return;
    }
    const harvested = await this.ports.harvest(thread);
    this.write(runId, (current) =>
      completeInstance(
        current,
        instanceKey,
        { ...harvested, turnState: settled.turnState },
        this.ports.now(),
      ),
    );
    void this.tick(runId);
  }

  private reconcile(run: WorkflowRun): void {
    if (run.status !== "in-progress") return;
    for (const instance of Object.values(run.instances)) {
      if (instance.status !== "running") continue;
      if (instance.thread) {
        void this.watch(run.id, instance.key, instance.thread);
        continue;
      }
      // Fan-out instances run without a thread while their lanes work; an agent instance that
      // never got a thread lost its dispatch mid-flight.
      if (isFanOutInstance(run, instance.key)) continue;
      this.write(run.id, (current) =>
        failInstance(
          current,
          instance.key,
          "The app closed before the agent was started.",
          this.ports.now(),
        ),
      );
    }
    void this.tick(run.id);
  }

  private deferUntilReady(runId: string, environmentId: EnvironmentId): void {
    if (this.deferred.has(runId)) return;
    const cancel = this.ports.onEnvironmentReady(environmentId, () => {
      this.deferred.delete(runId);
      const run = this.readRun(runId);
      if (!run) return;
      // Threads that settled while we were away are picked up by re-watching them.
      for (const instance of Object.values(run.instances)) {
        if (instance.status === "running" && instance.thread) {
          void this.watch(runId, instance.key, instance.thread);
        }
      }
      void this.tick(runId);
    });
    this.deferred.set(runId, cancel);
  }

  private armTimer(runId: string, at: string): void {
    const existing = this.timers.get(runId);
    if (existing?.at === at) return;
    existing?.cancel();
    const delay = Date.parse(at) - Date.parse(this.ports.now());
    const cancel = this.ports.schedule(Math.max(0, delay), () => {
      this.timers.delete(runId);
      // The timer is the pause; clear the deadline so planning does not re-arm it on a fast clock.
      this.write(runId, (current) =>
        current.nextIterationAt === at ? { ...current, nextIterationAt: null } : current,
      );
      void this.tick(runId);
    });
    this.timers.set(runId, { at, cancel });
  }

  private clearTimer(runId: string): void {
    this.timers.get(runId)?.cancel();
    this.timers.delete(runId);
  }

  private readRun(runId: string): WorkflowRun | null {
    return findWorkflowRun(this.store.getState().byProjectKey, runId);
  }

  private write(runId: string, updater: (run: WorkflowRun) => WorkflowRun): void {
    this.store.getState().patchRun(runId, updater);
  }
}

function isFanOutInstance(run: WorkflowRun, instanceKey: string): boolean {
  const nodeId = instanceKey.split(":")[0]!;
  return run.snapshot.nodes.some((node) => node.kind === "fan-out" && node.id === nodeId);
}
