/**
 * The runner's only door to the outside world: dispatching turns, watching threads, timers.
 * `createAtomRunnerPorts` binds it to the app's atom registry; tests pass a fake.
 */
import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { connectionProjectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentProject, EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ModelSelection,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerProvider,
  ThreadEnvMode,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";
import { resolveDefaultThreadEnvMode } from "@t3tools/shared/threadEnvMode";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { getComposerProviderState } from "~/components/chat/composerProviderState";
import { readT3ProjectFileDefaultThreadEnvMode } from "~/lib/t3ProjectFileDefaults";
import { newMessageId, newThreadId, randomHex } from "~/lib/utils";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import { getDefaultServerModel, getProviderModelCapabilities } from "~/providerModels";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentCatalog } from "~/connection/catalog";
import { readProject, readThreadShell } from "~/state/entities";
import {
  environmentServerConfigsAtom,
  primaryServerProvidersAtom,
  primaryServerSettingsAtom,
} from "~/state/server";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "~/state/threads";
import { vcsEnvironment } from "~/state/vcs";
import { isLatestTurnSettled } from "~/session-logic";
import type { WorkflowInstanceThread } from "~/workflowsStore";

import type { HarvestedTurn, StartAgentRequest } from "./workflowRunner.logic";

export type StartAgentResult =
  | { ok: true; thread: WorkflowInstanceThread }
  | { ok: false; error: string };

export type SettleResult =
  | { kind: "settled"; turnState: "completed" | "interrupted" | "error" }
  | { kind: "deleted" }
  | { kind: "aborted" };

export interface RunnerPorts {
  startAgent: (
    request: StartAgentRequest,
    projectRef: ScopedProjectRef,
  ) => Promise<StartAgentResult>;
  waitForSettled: (thread: WorkflowInstanceThread, signal: AbortSignal) => Promise<SettleResult>;
  harvest: (thread: WorkflowInstanceThread) => Promise<HarvestedTurn>;
  interrupt: (thread: WorkflowInstanceThread) => Promise<void>;
  deleteThread: (thread: WorkflowInstanceThread) => Promise<void>;
  isEnvironmentReady: (environmentId: EnvironmentId) => boolean;
  onEnvironmentReady: (environmentId: EnvironmentId, callback: () => void) => () => void;
  now: () => string;
  schedule: (delayMs: number, callback: () => void) => () => void;
}

/** How long a fresh thread may stay absent from the shell before we call the dispatch lost. */
const MISSING_SHELL_GRACE_MS = 60_000;
/** How long harvest waits for the final assistant message to land in the detail projection. */
const HARVEST_TIMEOUT_MS = 20_000;

function threadRef(thread: WorkflowInstanceThread): ScopedThreadRef {
  return { environmentId: thread.environmentId, threadId: thread.threadId };
}

function readProviders(environmentId: EnvironmentId): ReadonlyArray<ServerProvider> {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  return config?.providers ?? appAtomRegistry.get(primaryServerProvidersAtom);
}

/** The first enabled, available provider instance's default model. */
function fallbackModelSelection(providers: ReadonlyArray<ServerProvider>): ModelSelection | null {
  const entry = deriveProviderInstanceEntries(providers).find(
    (candidate) => candidate.enabled && candidate.isAvailable && candidate.installed,
  );
  if (!entry) return null;
  return {
    instanceId: entry.instanceId,
    model: getDefaultServerModel(providers, entry.driverKind),
  };
}

function isEnvironmentReady(environmentId: EnvironmentId): boolean {
  const state = Option.getOrNull(
    AsyncResult.value(appAtomRegistry.get(environmentCatalog.stateAtom(environmentId))),
  );
  return state !== null && connectionProjectionPhase(state) === "ready";
}

async function resolveEnvMode(
  environmentId: EnvironmentId,
  project: EnvironmentProject,
): Promise<ThreadEnvMode> {
  const settings = appAtomRegistry.get(primaryServerSettingsAtom);
  const consultProjectFile = project.defaultThreadEnvMode == null;
  return resolveDefaultThreadEnvMode({
    projectSetting: project.defaultThreadEnvMode,
    projectFile: consultProjectFile
      ? await readT3ProjectFileDefaultThreadEnvMode(environmentId, project.workspaceRoot)
      : null,
    globalDefault: settings.defaultThreadEnvMode,
  });
}

async function readCurrentBranch(
  environmentId: EnvironmentId,
  cwd: string,
): Promise<string | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    vcsEnvironment.status({ environmentId, input: { cwd } }),
    { reportDefect: false, reportFailure: false },
  );
  return result._tag === "Success" ? (result.value.refName ?? null) : null;
}

export function createAtomRunnerPorts(): RunnerPorts {
  const startAgent: RunnerPorts["startAgent"] = async (request, projectRef) => {
    const { environmentId } = projectRef;
    const project = readProject(projectRef);
    if (!project) return { ok: false, error: "The workflow's project is not available." };
    const providers = readProviders(environmentId);
    const modelSelection =
      request.modelSelection ?? project.defaultModelSelection ?? fallbackModelSelection(providers);
    if (!modelSelection) return { ok: false, error: "No provider is available to run the agent." };
    const provider = providers.find(
      (candidate) => candidate.instanceId === modelSelection.instanceId,
    );
    const text = provider ? formatPrompt(provider, modelSelection, request.prompt) : request.prompt;
    const now = new Date().toISOString();

    if (request.session.kind === "continue") {
      const shell = readThreadShell(threadRef(request.session.thread));
      const afterTurnId = shell?.latestTurn?.turnId ?? request.session.thread.afterTurnId;
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.startTurn,
        {
          environmentId,
          input: {
            threadId: request.session.thread.threadId,
            message: { messageId: newMessageId(), role: "user", text, attachments: [] },
            modelSelection,
            runtimeMode: request.runtimeMode,
            interactionMode: "default",
            createdAt: now,
          },
        },
        { label: "workflow-runner:continue-turn", reportFailure: false },
      );
      if (result._tag === "Failure") {
        return { ok: false, error: describeFailure(result) };
      }
      return {
        ok: true,
        thread: { ...request.session.thread, dispatchedAt: now, afterTurnId },
      };
    }

    const envMode: ThreadEnvMode =
      request.envMode === "default"
        ? await resolveEnvMode(environmentId, project)
        : request.envMode;
    const currentBranch = await readCurrentBranch(environmentId, project.workspaceRoot);
    const useWorktree = envMode === "worktree" && currentBranch !== null;
    const settings = appAtomRegistry.get(primaryServerSettingsAtom);
    const threadId = newThreadId();
    const result = await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.startTurn,
      {
        environmentId,
        input: {
          threadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          modelSelection,
          titleSeed: request.title,
          runtimeMode: request.runtimeMode,
          interactionMode: "default",
          bootstrap: {
            createThread: {
              projectId: projectRef.projectId,
              title: request.title,
              modelSelection,
              runtimeMode: request.runtimeMode,
              interactionMode: "default",
              branch: currentBranch,
              worktreePath: null,
              createdAt: now,
            },
            ...(useWorktree
              ? {
                  prepareWorktree: {
                    projectCwd: project.workspaceRoot,
                    baseBranch: currentBranch,
                    branch: buildTemporaryWorktreeBranchName(randomHex),
                    ...(settings.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
                  },
                  runSetupScript: true,
                }
              : {}),
          },
          createdAt: now,
        },
      },
      { label: "workflow-runner:start-turn", reportFailure: false },
    );
    if (result._tag === "Failure") {
      void runAtomCommand(
        appAtomRegistry,
        threadEnvironment.delete,
        { environmentId, input: { threadId } },
        { label: "workflow-runner:cleanup", reportFailure: false, reportDefect: false },
      );
      return { ok: false, error: describeFailure(result) };
    }
    return { ok: true, thread: { environmentId, threadId, dispatchedAt: now, afterTurnId: null } };
  };

  const waitForSettled: RunnerPorts["waitForSettled"] = (thread, signal) => {
    const ref = threadRef(thread);
    const atom = environmentThreadShells.threadShellAtom(ref);
    return new Promise<SettleResult>((resolve) => {
      let finished = false;
      let seen = false;
      let unsubscribe = () => {};
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (result: SettleResult) => {
        if (finished) return;
        finished = true;
        if (graceTimer !== null) clearTimeout(graceTimer);
        signal.removeEventListener("abort", onAbort);
        unsubscribe();
        resolve(result);
      };
      const onAbort = () => finish({ kind: "aborted" });
      const check = (shell: ReturnType<typeof readThreadShell>) => {
        if (shell === null) {
          if (seen) finish({ kind: "deleted" });
          return;
        }
        seen = true;
        const latestTurn = shell.latestTurn;
        if (!latestTurn) return;
        if (thread.afterTurnId !== null && latestTurn.turnId === thread.afterTurnId) return;
        if (!isLatestTurnSettled(latestTurn, shell.session)) return;
        finish({
          kind: "settled",
          turnState: latestTurn.state === "running" ? "completed" : latestTurn.state,
        });
      };
      if (signal.aborted) {
        finish({ kind: "aborted" });
        return;
      }
      signal.addEventListener("abort", onAbort);
      unsubscribe = appAtomRegistry.subscribe(atom, check);
      check(appAtomRegistry.get(atom));
      if (!finished && !seen) {
        graceTimer = setTimeout(() => {
          if (!seen && isEnvironmentReady(thread.environmentId)) finish({ kind: "deleted" });
        }, MISSING_SHELL_GRACE_MS);
      }
    });
  };

  const harvest: RunnerPorts["harvest"] = (thread) => {
    const ref = threadRef(thread);
    const detailAtom = environmentThreadDetails.detailAtom(ref);
    const shell = readThreadShell(ref);
    const latestTurn = shell?.latestTurn ?? null;
    const turnState: HarvestedTurn["turnState"] =
      latestTurn?.state === "interrupted" || latestTurn?.state === "error"
        ? latestTurn.state
        : "completed";
    return new Promise<HarvestedTurn>((resolve) => {
      let finished = false;
      let unsubscribe = () => {};
      const finish = (detail: EnvironmentThread | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        const message = latestTurn?.assistantMessageId
          ? detail?.messages.find((candidate) => candidate.id === latestTurn.assistantMessageId)
          : detail?.messages.findLast((candidate) => candidate.role === "assistant");
        const checkpoint = latestTurn
          ? detail?.checkpoints.find((candidate) => candidate.turnId === latestTurn.turnId)
          : undefined;
        resolve({
          text: message?.text ?? "",
          files: (checkpoint?.files ?? []).map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
          })),
          turnState,
        });
      };
      const ready = (detail: EnvironmentThread | null) => {
        if (!detail) return false;
        if (!latestTurn?.assistantMessageId) return true;
        const message = detail.messages.find(
          (candidate) => candidate.id === latestTurn.assistantMessageId,
        );
        return message !== undefined && !message.streaming;
      };
      const timer = setTimeout(() => finish(appAtomRegistry.get(detailAtom)), HARVEST_TIMEOUT_MS);
      unsubscribe = appAtomRegistry.subscribe(detailAtom, (detail) => {
        if (ready(detail)) finish(detail);
      });
      const current = appAtomRegistry.get(detailAtom);
      if (ready(current)) finish(current);
    });
  };

  const interrupt: RunnerPorts["interrupt"] = async (thread) => {
    await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.interruptTurn,
      { environmentId: thread.environmentId, input: { threadId: thread.threadId } },
      { label: "workflow-runner:interrupt", reportFailure: false, reportDefect: false },
    );
  };

  const deleteThread: RunnerPorts["deleteThread"] = async (thread) => {
    await runAtomCommand(
      appAtomRegistry,
      threadEnvironment.delete,
      { environmentId: thread.environmentId, input: { threadId: thread.threadId } },
      { label: "workflow-runner:delete", reportFailure: false, reportDefect: false },
    );
  };

  const onEnvironmentReady: RunnerPorts["onEnvironmentReady"] = (environmentId, callback) => {
    if (isEnvironmentReady(environmentId)) {
      callback();
      return () => {};
    }
    let done = false;
    const unsubscribe = appAtomRegistry.subscribe(
      environmentCatalog.stateAtom(environmentId),
      () => {
        if (done || !isEnvironmentReady(environmentId)) return;
        done = true;
        unsubscribe();
        callback();
      },
    );
    return () => {
      done = true;
      unsubscribe();
    };
  };

  return {
    startAgent,
    waitForSettled,
    harvest,
    interrupt,
    deleteThread,
    isEnvironmentReady,
    onEnvironmentReady,
    now: () => new Date().toISOString(),
    schedule: (delayMs, callback) => {
      const timer = setTimeout(callback, Math.max(0, delayMs));
      return () => clearTimeout(timer);
    },
  };
}

/** Same effort prefixing the composer applies before sending (see ChatView.formatOutgoingPrompt). */
function formatPrompt(provider: ServerProvider, selection: ModelSelection, prompt: string): string {
  const state = getComposerProviderState({
    provider: provider.driver,
    model: selection.model,
    models: provider.models,
    modelOptions: selection.options,
  });
  const caps = getProviderModelCapabilities(provider.models, selection.model, provider.driver);
  const effort = resolvePromptInjectedEffort(caps, state.promptEffort);
  return applyClaudePromptEffortPrefix(prompt, effort);
}

function describeFailure(result: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}): string {
  const squashed = squashAtomCommandFailure(result);
  const text =
    squashed instanceof Error
      ? squashed.message
      : typeof squashed === "string"
        ? squashed
        : "The agent could not be started.";
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
