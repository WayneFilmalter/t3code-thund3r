/**
 * Project-scoped workflow definitions and runs for the Workflows right-panel surface.
 *
 * Workflows belong to a project (they run in its directory, not in a thread), so the store is
 * keyed by scoped project key. This is client-local for now; a server contract that syncs
 * workflows across devices is the planned follow-up, at which point this file becomes a cache
 * of that projection. The shapes below are written to become that contract as-is.
 *
 * A definition is a top-down chain of nodes; a `fan-out` node owns a lane (its own chain) run
 * once per item. A run freezes the definition's graph and tracks one instance per executed
 * node (`${nodeId}:${iteration}` or `${nodeId}:${iteration}:${laneIndex}` inside a lane).
 * Runs never persist messages: only the extracted output, capped, and the thread reference.
 */
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ScopedProjectRef,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export type WorkflowEnvMode = "default" | "local" | "worktree";
export type WorkflowSessionMode = "new" | "continue";
export type WorkflowOutputKind = "none" | "list" | "object";
export interface WorkflowOutputSpec {
  kind: WorkflowOutputKind;
  /** Free-text shape hint shown to the agent, e.g. `{ id, identifier, title, url }[]`. */
  hint: string;
}
export type WorkflowLinearPreset = "find" | "update" | "custom";
export type WorkflowActionPreset = "commit-pr" | "commit" | "comment-ticket" | "custom";
export type WorkflowDoneWhen = "source-empty" | "gate-pass" | "max-only";
export type WorkflowGateOnFail =
  | { kind: "stop" }
  | { kind: "retry"; times: number }
  | { kind: "continue" };

export interface WorkflowStartNode {
  id: string;
  kind: "start";
  mode: "once" | "loop";
  maxIterations: number;
  pauseSeconds: number;
  doneWhen: WorkflowDoneWhen;
}
export interface WorkflowAgentNode {
  id: string;
  kind: "agent" | "linear-agent";
  title: string;
  prompt: string;
  /** Only meaningful for `linear-agent`; picks the baked Linear instructions. */
  preset: WorkflowLinearPreset;
  /** `null` runs on the project's default model. */
  modelSelection: ModelSelection | null;
  runtimeMode: RuntimeMode;
  envMode: WorkflowEnvMode;
  session: WorkflowSessionMode;
  skills: string[];
  output: WorkflowOutputSpec;
}
export interface WorkflowFanOutNode {
  id: string;
  kind: "fan-out";
  maxParallel: number;
  laneEnvMode: WorkflowEnvMode;
  lane: WorkflowNode[];
}
export interface WorkflowGateNode {
  id: string;
  kind: "gate";
  question: string;
  onFail: WorkflowGateOnFail;
  modelSelection: ModelSelection | null;
}
export interface WorkflowReviewNode {
  id: string;
  kind: "review";
  instructions: string;
}
export interface WorkflowActionNode {
  id: string;
  kind: "action";
  preset: WorkflowActionPreset;
  prompt: string;
  session: WorkflowSessionMode;
}
export interface WorkflowPromptBlockNode {
  id: string;
  kind: "prompt-block";
  text: string;
  placement: "before" | "after";
}
export interface WorkflowEndNode {
  id: string;
  kind: "end";
  reportPrompt: string;
}
export type WorkflowNode =
  | WorkflowStartNode
  | WorkflowAgentNode
  | WorkflowFanOutNode
  | WorkflowGateNode
  | WorkflowReviewNode
  | WorkflowActionNode
  | WorkflowPromptBlockNode
  | WorkflowEndNode;
export type WorkflowNodeKind = WorkflowNode["kind"];

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string | null;
  /** Hex accent for the workflow's bubble, normalized to `#rrggbb`. */
  color: string;
  /** Prepended to every agent prompt in the workflow: the "pre-injected" context. */
  sharedContext: string;
  nodes: WorkflowNode[];
  createdAt: string;
  updatedAt: string;
  /** ISO time of the next scheduled run; non-null definitions also list under Scheduled. */
  scheduledFor: string | null;
}

/** `done` is history; `failed` and `cancelled` list under Stuck with a reason. */
export type WorkflowRunStatus =
  | "in-progress"
  | "review"
  | "stuck"
  | "done"
  | "failed"
  | "cancelled";
export type WorkflowInstanceStatus =
  | "pending"
  | "running"
  | "waiting-review"
  | "done"
  | "failed"
  | "skipped";

export type WorkflowStepOutput = { kind: "json"; value: unknown } | { kind: "text"; text: string };

export interface WorkflowInstanceThread {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  /** ISO time the turn was dispatched (client clock, display only). */
  dispatchedAt: string;
  /**
   * The thread's latest turn id before this dispatch, `null` for a fresh thread. The runner
   * treats the turn as ours once `latestTurn.turnId` differs from it, so clocks never matter.
   */
  afterTurnId: string | null;
}

export interface WorkflowNodeInstance {
  key: string;
  nodeId: string;
  iteration: number;
  /** Lane index when the instance runs inside a fan-out lane. */
  index?: number;
  status: WorkflowInstanceStatus;
  thread?: WorkflowInstanceThread;
  output?: WorkflowStepOutput;
  files?: Array<{ path: string; additions: number; deletions: number }>;
  error?: string;
  /** Gate retries so far, when the node is a gate with `onFail: retry`. */
  attempt?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkflowRun {
  id: string;
  definitionId: string;
  name: string;
  color: string;
  projectRef: ScopedProjectRef;
  snapshot: Pick<WorkflowDefinition, "sharedContext" | "nodes">;
  status: WorkflowRunStatus;
  iteration: number;
  nextIterationAt: string | null;
  instances: Record<string, WorkflowNodeInstance>;
  review: { instanceKey: string; summary: string } | null;
  /** The end node's report for the latest iteration, capped. */
  result: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}

export interface WorkflowProjectState {
  definitions: WorkflowDefinition[];
  runs: WorkflowRun[];
}

export const DEFAULT_WORKFLOW_COLOR = "#22d3ee";
export const WORKFLOW_COLOR_SWATCHES: readonly string[] = [
  "#22d3ee",
  "#a3e635",
  "#f472b6",
  "#fb923c",
  "#a78bfa",
  "#facc15",
  "#34d399",
  "#60a5fa",
];
/** Finished runs kept per project; older history is dropped on the next prune. */
export const WORKFLOW_RUN_HISTORY_LIMIT = 20;

export const newWorkflowNodeId = (): string => randomUUID();

/** `#rrggbb` lowercase, or the default when the value is not a usable hex colour. */
export function normalizeWorkflowColor(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return DEFAULT_WORKFLOW_COLOR;
}

export function createStartNode(
  overrides: Partial<Omit<WorkflowStartNode, "kind">> = {},
): WorkflowStartNode {
  return {
    id: newWorkflowNodeId(),
    kind: "start",
    mode: "once",
    maxIterations: 10,
    pauseSeconds: 0,
    doneWhen: "source-empty",
    ...overrides,
  };
}

export function createEndNode(
  overrides: Partial<Omit<WorkflowEndNode, "kind">> = {},
): WorkflowEndNode {
  return { id: newWorkflowNodeId(), kind: "end", reportPrompt: "", ...overrides };
}

export function createAgentNode(
  kind: "agent" | "linear-agent",
  overrides: Partial<Omit<WorkflowAgentNode, "kind">> = {},
): WorkflowAgentNode {
  return {
    id: newWorkflowNodeId(),
    kind,
    title: kind === "linear-agent" ? "Linear" : "Agent",
    prompt: "",
    preset: kind === "linear-agent" ? "find" : "custom",
    modelSelection: null,
    runtimeMode: "full-access",
    envMode: "default",
    session: "new",
    skills: [],
    output:
      kind === "linear-agent"
        ? { kind: "list", hint: "{ id, identifier, title, url }[]" }
        : { kind: "none", hint: "" },
    ...overrides,
  };
}

export function createFanOutNode(
  overrides: Partial<Omit<WorkflowFanOutNode, "kind">> = {},
): WorkflowFanOutNode {
  return {
    id: newWorkflowNodeId(),
    kind: "fan-out",
    maxParallel: 3,
    laneEnvMode: "default",
    lane: [],
    ...overrides,
  };
}

export function createGateNode(
  overrides: Partial<Omit<WorkflowGateNode, "kind">> = {},
): WorkflowGateNode {
  return {
    id: newWorkflowNodeId(),
    kind: "gate",
    question: "",
    onFail: { kind: "stop" },
    modelSelection: null,
    ...overrides,
  };
}

export function createReviewNode(
  overrides: Partial<Omit<WorkflowReviewNode, "kind">> = {},
): WorkflowReviewNode {
  return { id: newWorkflowNodeId(), kind: "review", instructions: "", ...overrides };
}

export function createActionNode(
  overrides: Partial<Omit<WorkflowActionNode, "kind">> = {},
): WorkflowActionNode {
  return {
    id: newWorkflowNodeId(),
    kind: "action",
    preset: "commit-pr",
    prompt: "",
    session: "continue",
    ...overrides,
  };
}

export function createPromptBlockNode(
  overrides: Partial<Omit<WorkflowPromptBlockNode, "kind">> = {},
): WorkflowPromptBlockNode {
  return {
    id: newWorkflowNodeId(),
    kind: "prompt-block",
    text: "",
    placement: "before",
    ...overrides,
  };
}

/** A fresh definition graph: Start → End, ready for nodes in between. */
export function createBlankNodes(): WorkflowNode[] {
  return [createStartNode(), createEndNode()];
}

export interface WorkflowDefinitionInput {
  name: string;
  description?: string | null;
  color?: string;
  sharedContext?: string;
  nodes?: WorkflowNode[];
}

interface WorkflowsStoreState {
  byProjectKey: Record<string, WorkflowProjectState>;
  addDefinition: (ref: ScopedProjectRef, input: WorkflowDefinitionInput) => WorkflowDefinition;
  updateDefinition: (
    ref: ScopedProjectRef,
    definitionId: string,
    patch: Partial<Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">>,
  ) => void;
  duplicateDefinition: (ref: ScopedProjectRef, definitionId: string) => WorkflowDefinition | null;
  removeDefinition: (ref: ScopedProjectRef, definitionId: string) => void;
  removeProject: (ref: ScopedProjectRef) => void;
  createRun: (ref: ScopedProjectRef, definition: WorkflowDefinition) => WorkflowRun;
  patchRun: (runId: string, updater: (run: WorkflowRun) => WorkflowRun) => void;
  setInstance: (runId: string, instance: WorkflowNodeInstance) => void;
  removeRun: (runId: string) => void;
  pruneRuns: (ref: ScopedProjectRef) => void;
}

const EMPTY_PROJECT_STATE: WorkflowProjectState = { definitions: [], runs: [] };

const FINISHED_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "done",
  "failed",
  "cancelled",
]);

export function isFinishedWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return FINISHED_RUN_STATUSES.has(status);
}

/** Deep-copies a node chain with fresh ids so a duplicate never shares node identity. */
export function cloneNodesWithFreshIds(nodes: readonly WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) =>
    node.kind === "fan-out"
      ? { ...node, id: newWorkflowNodeId(), lane: cloneNodesWithFreshIds(node.lane) }
      : { ...node, id: newWorkflowNodeId() },
  );
}

type StoreUpdate = Pick<WorkflowsStoreState, "byProjectKey"> | WorkflowsStoreState;

function updateProject(
  state: WorkflowsStoreState,
  ref: ScopedProjectRef,
  update: (project: WorkflowProjectState) => WorkflowProjectState | null,
): StoreUpdate {
  const projectKey = scopedProjectKey(ref);
  const current = state.byProjectKey[projectKey] ?? EMPTY_PROJECT_STATE;
  const next = update(current);
  if (next === null || next === current) return state;
  return { byProjectKey: { ...state.byProjectKey, [projectKey]: next } };
}

function updateRunAcrossProjects(
  state: WorkflowsStoreState,
  runId: string,
  update: (run: WorkflowRun) => WorkflowRun | null,
): StoreUpdate {
  for (const [projectKey, project] of Object.entries(state.byProjectKey)) {
    const index = project.runs.findIndex((run) => run.id === runId);
    if (index === -1) continue;
    const current = project.runs[index]!;
    const next = update(current);
    if (next === current) return state;
    const runs = [...project.runs];
    if (next === null) runs.splice(index, 1);
    else runs[index] = next;
    return { byProjectKey: { ...state.byProjectKey, [projectKey]: { ...project, runs } } };
  }
  return state;
}

export const useWorkflowsStore = create<WorkflowsStoreState>()(
  persist(
    (set, get) => ({
      byProjectKey: {},
      addDefinition: (ref, input) => {
        const now = new Date().toISOString();
        const definition: WorkflowDefinition = {
          id: randomUUID(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          color: normalizeWorkflowColor(input.color),
          sharedContext: input.sharedContext ?? "",
          nodes: input.nodes ?? createBlankNodes(),
          createdAt: now,
          updatedAt: now,
          scheduledFor: null,
        };
        set((state) =>
          updateProject(state, ref, (project) => ({
            ...project,
            definitions: [...project.definitions, definition],
          })),
        );
        return definition;
      },
      updateDefinition: (ref, definitionId, patch) =>
        set((state) =>
          updateProject(state, ref, (project) => {
            const index = project.definitions.findIndex((entry) => entry.id === definitionId);
            if (index === -1) return null;
            const current = project.definitions[index]!;
            const definitions = [...project.definitions];
            definitions[index] = {
              ...current,
              ...patch,
              ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
              ...(patch.description !== undefined
                ? { description: patch.description?.trim() || null }
                : {}),
              ...(patch.color !== undefined ? { color: normalizeWorkflowColor(patch.color) } : {}),
              updatedAt: new Date().toISOString(),
            };
            return { ...project, definitions };
          }),
        ),
      duplicateDefinition: (ref, definitionId) => {
        const source = selectProjectWorkflows(get().byProjectKey, ref).definitions.find(
          (entry) => entry.id === definitionId,
        );
        if (!source) return null;
        return get().addDefinition(ref, {
          name: `${source.name} copy`,
          description: source.description,
          color: source.color,
          sharedContext: source.sharedContext,
          nodes: cloneNodesWithFreshIds(source.nodes),
        });
      },
      removeDefinition: (ref, definitionId) =>
        set((state) =>
          updateProject(state, ref, (project) => {
            const definitions = project.definitions.filter((entry) => entry.id !== definitionId);
            if (definitions.length === project.definitions.length) return null;
            return { ...project, definitions };
          }),
        ),
      removeProject: (ref) =>
        set((state) => {
          const projectKey = scopedProjectKey(ref);
          if (!(projectKey in state.byProjectKey)) return state;
          const { [projectKey]: _removed, ...byProjectKey } = state.byProjectKey;
          return { byProjectKey };
        }),
      createRun: (ref, definition) => {
        const run: WorkflowRun = {
          id: randomUUID(),
          definitionId: definition.id,
          name: definition.name,
          color: definition.color,
          projectRef: ref,
          snapshot: { sharedContext: definition.sharedContext, nodes: definition.nodes },
          status: "in-progress",
          iteration: 0,
          nextIterationAt: null,
          instances: {},
          review: null,
          result: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          lastError: null,
        };
        set((state) =>
          updateProject(state, ref, (project) => ({ ...project, runs: [...project.runs, run] })),
        );
        return run;
      },
      patchRun: (runId, updater) => set((state) => updateRunAcrossProjects(state, runId, updater)),
      setInstance: (runId, instance) =>
        set((state) =>
          updateRunAcrossProjects(state, runId, (run) => ({
            ...run,
            instances: { ...run.instances, [instance.key]: instance },
          })),
        ),
      removeRun: (runId) => set((state) => updateRunAcrossProjects(state, runId, () => null)),
      pruneRuns: (ref) =>
        set((state) =>
          updateProject(state, ref, (project) => {
            const finished = project.runs
              .filter((run) => isFinishedWorkflowRunStatus(run.status))
              .sort((left, right) =>
                (right.finishedAt ?? right.startedAt).localeCompare(
                  left.finishedAt ?? left.startedAt,
                ),
              );
            if (finished.length <= WORKFLOW_RUN_HISTORY_LIMIT) return null;
            const dropped = new Set(
              finished.slice(WORKFLOW_RUN_HISTORY_LIMIT).map((run) => run.id),
            );
            return { ...project, runs: project.runs.filter((run) => !dropped.has(run.id)) };
          }),
        ),
    }),
    {
      name: "t3code:workflows-state:v1",
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
      migrate: (persisted, version) => migratePersistedWorkflows(persisted, version),
    },
  ),
);

/**
 * v1 definitions had no graph or colour; give them a blank Start → End graph. v1 runs had no
 * instances or snapshot and cannot be resumed, so they are dropped.
 */
export function migratePersistedWorkflows(
  persisted: unknown,
  version: number,
): { byProjectKey: Record<string, WorkflowProjectState> } {
  const source =
    persisted && typeof persisted === "object" && "byProjectKey" in persisted
      ? ((persisted as { byProjectKey?: Record<string, Partial<WorkflowProjectState>> })
          .byProjectKey ?? {})
      : {};
  if (version >= 2) return { byProjectKey: source as Record<string, WorkflowProjectState> };
  const byProjectKey: Record<string, WorkflowProjectState> = {};
  for (const [projectKey, project] of Object.entries(source)) {
    byProjectKey[projectKey] = {
      definitions: (project.definitions ?? []).map((definition) => ({
        ...definition,
        color: normalizeWorkflowColor((definition as { color?: string }).color),
        sharedContext: (definition as { sharedContext?: string }).sharedContext ?? "",
        nodes: Array.isArray((definition as { nodes?: unknown }).nodes)
          ? (definition as WorkflowDefinition).nodes
          : createBlankNodes(),
      })),
      runs: (project.runs ?? []).filter(
        (run) => run && typeof run === "object" && "instances" in run && "snapshot" in run,
      ),
    };
  }
  return { byProjectKey };
}

/** The project's workflows, or one shared empty state so a missing project never re-renders. */
export function selectProjectWorkflows(
  byProjectKey: Record<string, WorkflowProjectState>,
  ref: ScopedProjectRef | null | undefined,
): WorkflowProjectState {
  if (!ref) return EMPTY_PROJECT_STATE;
  return byProjectKey[scopedProjectKey(ref)] ?? EMPTY_PROJECT_STATE;
}

export function findWorkflowRun(
  byProjectKey: Record<string, WorkflowProjectState>,
  runId: string,
): WorkflowRun | null {
  for (const project of Object.values(byProjectKey)) {
    const run = project.runs.find((entry) => entry.id === runId);
    if (run) return run;
  }
  return null;
}

/** Every run that still needs the runner's attention, across projects. */
export function selectActiveWorkflowRuns(
  byProjectKey: Record<string, WorkflowProjectState>,
): WorkflowRun[] {
  const runs: WorkflowRun[] = [];
  for (const project of Object.values(byProjectKey)) {
    for (const run of project.runs) {
      if (!isFinishedWorkflowRunStatus(run.status)) runs.push(run);
    }
  }
  return runs;
}
