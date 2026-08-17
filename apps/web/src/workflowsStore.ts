/**
 * Project-scoped workflow definitions and runs for the Workflows right-panel surface.
 *
 * Workflows belong to a project (they run in its directory, not in a thread), so the store is
 * keyed by scoped project key. This is client-local for now; a server contract that syncs
 * workflows across devices is the planned follow-up, at which point this file becomes a cache
 * of that projection and the run transitions below become requests instead of local edits.
 */
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

/** `done` is history: reviewed and put away, kept so the panel can show what ran when. */
export type WorkflowRunStatus = "in-progress" | "review" | "stuck" | "done";

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO time of the next scheduled run; non-null definitions also list under Scheduled. */
  scheduledFor: string | null;
}

export interface WorkflowRun {
  id: string;
  definitionId: string;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Set while an in-progress run is paused; it stays under In progress and offers Resume. */
  pausedAt: string | null;
  /** What the agents are doing right now ("Researching", "Testing"…); free-form, agent-set. */
  stage: string | null;
  /** 0..1 fraction of the run; null while running means unknown and shows as a spinner. */
  progress: number | null;
  /** Total tokens the run has used so far. */
  tokens: number;
  /** Bubble body: the current activity while running, the outcome (or why it is stuck) after. */
  summary: string | null;
}

export interface WorkflowProjectState {
  definitions: WorkflowDefinition[];
  runs: WorkflowRun[];
}

interface WorkflowsStoreState {
  byProjectKey: Record<string, WorkflowProjectState>;
  addDefinition: (
    ref: ScopedProjectRef,
    input: { name: string; description?: string },
  ) => WorkflowDefinition;
  removeDefinition: (ref: ScopedProjectRef, definitionId: string) => void;
  setSchedule: (ref: ScopedProjectRef, definitionId: string, scheduledFor: string | null) => void;
  startRun: (ref: ScopedProjectRef, definitionId: string) => WorkflowRun;
  pauseRun: (ref: ScopedProjectRef, runId: string) => void;
  resumeRun: (ref: ScopedProjectRef, runId: string) => void;
  restartRun: (ref: ScopedProjectRef, runId: string) => void;
  removeProject: (ref: ScopedProjectRef) => void;
}

const EMPTY_PROJECT_STATE: WorkflowProjectState = { definitions: [], runs: [] };

/** Fields added after v1; filled in for persisted runs that predate them. */
const RUN_DEFAULTS = {
  pausedAt: null,
  stage: null,
  progress: null,
  tokens: 0,
  summary: null,
} satisfies Partial<WorkflowRun>;

export const useWorkflowsStore = create<WorkflowsStoreState>()(
  persist(
    (set) => {
      const updateProject = (
        ref: ScopedProjectRef,
        update: (current: WorkflowProjectState) => WorkflowProjectState | null,
      ) =>
        set((state) => {
          const projectKey = scopedProjectKey(ref);
          const current = state.byProjectKey[projectKey] ?? EMPTY_PROJECT_STATE;
          const next = update(current);
          if (next === null || next === current) return state;
          return { byProjectKey: { ...state.byProjectKey, [projectKey]: next } };
        });
      const updateRun = (
        ref: ScopedProjectRef,
        runId: string,
        update: (run: WorkflowRun) => WorkflowRun | null,
      ) =>
        updateProject(ref, (current) => {
          const index = current.runs.findIndex((run) => run.id === runId);
          if (index === -1) return null;
          const next = update(current.runs[index]!);
          if (next === null) return null;
          const runs = [...current.runs];
          runs[index] = next;
          return { ...current, runs };
        });

      return {
        byProjectKey: {},
        addDefinition: (ref, input) => {
          const now = new Date().toISOString();
          const definition: WorkflowDefinition = {
            id: randomUUID(),
            name: input.name.trim(),
            description: input.description?.trim() || null,
            createdAt: now,
            updatedAt: now,
            scheduledFor: null,
          };
          updateProject(ref, (current) => ({
            ...current,
            definitions: [...current.definitions, definition],
          }));
          return definition;
        },
        removeDefinition: (ref, definitionId) =>
          updateProject(ref, (current) => {
            const definitions = current.definitions.filter((entry) => entry.id !== definitionId);
            if (definitions.length === current.definitions.length) return null;
            return { ...current, definitions };
          }),
        setSchedule: (ref, definitionId, scheduledFor) =>
          updateProject(ref, (current) => {
            const index = current.definitions.findIndex((entry) => entry.id === definitionId);
            if (index === -1) return null;
            const definitions = [...current.definitions];
            definitions[index] = {
              ...definitions[index]!,
              scheduledFor,
              updatedAt: new Date().toISOString(),
            };
            return { ...current, definitions };
          }),
        startRun: (ref, definitionId) => {
          const run: WorkflowRun = {
            id: randomUUID(),
            definitionId,
            status: "in-progress",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            pausedAt: null,
            stage: "Planning",
            progress: 0,
            tokens: 0,
            summary: null,
          };
          updateProject(ref, (current) => ({ ...current, runs: [...current.runs, run] }));
          return run;
        },
        pauseRun: (ref, runId) =>
          updateRun(ref, runId, (run) =>
            run.status !== "in-progress" || run.pausedAt !== null
              ? null
              : { ...run, pausedAt: new Date().toISOString() },
          ),
        resumeRun: (ref, runId) =>
          updateRun(ref, runId, (run) =>
            run.pausedAt === null ? null : { ...run, pausedAt: null },
          ),
        restartRun: (ref, runId) =>
          updateRun(ref, runId, (run) =>
            run.status !== "stuck"
              ? null
              : {
                  ...run,
                  status: "in-progress",
                  startedAt: new Date().toISOString(),
                  finishedAt: null,
                  pausedAt: null,
                  progress: 0,
                },
          ),
        removeProject: (ref) =>
          set((state) => {
            const projectKey = scopedProjectKey(ref);
            if (!(projectKey in state.byProjectKey)) return state;
            const { [projectKey]: _removed, ...byProjectKey } = state.byProjectKey;
            return { byProjectKey };
          }),
      };
    },
    {
      name: "t3code:workflows-state:v1",
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
      migrate: (persisted, version) => {
        const state = persisted as { byProjectKey?: Record<string, WorkflowProjectState> };
        if (version >= 2 || !state.byProjectKey) return state;
        return {
          byProjectKey: Object.fromEntries(
            Object.entries(state.byProjectKey).map(([key, project]) => [
              key,
              { ...project, runs: project.runs.map((run) => ({ ...RUN_DEFAULTS, ...run })) },
            ]),
          ),
        };
      },
    },
  ),
);

/** The project's workflows, or one shared empty state so a missing project never re-renders. */
export function selectProjectWorkflows(
  byProjectKey: Record<string, WorkflowProjectState>,
  ref: ScopedProjectRef | null | undefined,
): WorkflowProjectState {
  if (!ref) return EMPTY_PROJECT_STATE;
  return byProjectKey[scopedProjectKey(ref)] ?? EMPTY_PROJECT_STATE;
}
