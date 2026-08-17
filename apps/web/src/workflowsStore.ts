/**
 * Project-scoped workflow definitions and runs for the Workflows right-panel surface.
 *
 * Workflows belong to a project (they run in its directory, not in a thread), so the store is
 * keyed by scoped project key. This is client-local for now; a server contract that syncs
 * workflows across devices is the planned follow-up, at which point this file becomes a cache
 * of that projection.
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
  removeProject: (ref: ScopedProjectRef) => void;
}

const EMPTY_PROJECT_STATE: WorkflowProjectState = { definitions: [], runs: [] };

export const useWorkflowsStore = create<WorkflowsStoreState>()(
  persist(
    (set) => ({
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
        set((state) => {
          const projectKey = scopedProjectKey(ref);
          const current = state.byProjectKey[projectKey] ?? EMPTY_PROJECT_STATE;
          return {
            byProjectKey: {
              ...state.byProjectKey,
              [projectKey]: { ...current, definitions: [...current.definitions, definition] },
            },
          };
        });
        return definition;
      },
      removeDefinition: (ref, definitionId) =>
        set((state) => {
          const projectKey = scopedProjectKey(ref);
          const current = state.byProjectKey[projectKey];
          if (!current) return state;
          const definitions = current.definitions.filter((entry) => entry.id !== definitionId);
          if (definitions.length === current.definitions.length) return state;
          return {
            byProjectKey: { ...state.byProjectKey, [projectKey]: { ...current, definitions } },
          };
        }),
      removeProject: (ref) =>
        set((state) => {
          const projectKey = scopedProjectKey(ref);
          if (!(projectKey in state.byProjectKey)) return state;
          const { [projectKey]: _removed, ...byProjectKey } = state.byProjectKey;
          return { byProjectKey };
        }),
    }),
    {
      name: "t3code:workflows-state:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
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
