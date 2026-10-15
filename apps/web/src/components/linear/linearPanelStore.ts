import type { LinearIssueStatus } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Which Linear sections are unfolded and armed, and the fetch-all count, per
 * environment. Session-only and outside React on purpose: the thread view
 * remounts on every thread switch, and the Linear tab has nothing to do with
 * threads, so its folds and fetched sections must not reset with them.
 */
export interface LinearSectionState {
  open: boolean;
  armed: boolean;
}

interface LinearPanelEnvironmentState {
  fetchRevision: number;
  sections: Partial<Record<LinearIssueStatus, LinearSectionState>>;
}

interface LinearPanelStoreState {
  byEnvironment: Record<string, LinearPanelEnvironmentState>;
  /** Unfolding a section also arms it: the first expand is the first fetch. */
  setSectionOpen: (environmentId: string, status: LinearIssueStatus, open: boolean) => void;
  armSection: (environmentId: string, status: LinearIssueStatus) => void;
  fetchAll: (environmentId: string) => void;
}

const EMPTY_ENVIRONMENT: LinearPanelEnvironmentState = { fetchRevision: 0, sections: {} };
const EMPTY_SECTION: LinearSectionState = { open: false, armed: false };

const updateSection = (
  state: LinearPanelStoreState,
  environmentId: string,
  status: LinearIssueStatus,
  updater: (section: LinearSectionState) => LinearSectionState,
): Pick<LinearPanelStoreState, "byEnvironment"> => {
  const environment = state.byEnvironment[environmentId] ?? EMPTY_ENVIRONMENT;
  return {
    byEnvironment: {
      ...state.byEnvironment,
      [environmentId]: {
        ...environment,
        sections: {
          ...environment.sections,
          [status]: updater(environment.sections[status] ?? EMPTY_SECTION),
        },
      },
    },
  };
};

export const useLinearPanelStore = create<LinearPanelStoreState>()((set) => ({
  byEnvironment: {},
  setSectionOpen: (environmentId, status, open) =>
    set((state) =>
      updateSection(state, environmentId, status, (section) => ({
        open,
        armed: section.armed || open,
      })),
    ),
  armSection: (environmentId, status) =>
    set((state) =>
      updateSection(state, environmentId, status, (section) =>
        section.armed ? section : { ...section, armed: true },
      ),
    ),
  fetchAll: (environmentId) =>
    set((state) => {
      const environment = state.byEnvironment[environmentId] ?? EMPTY_ENVIRONMENT;
      return {
        byEnvironment: {
          ...state.byEnvironment,
          [environmentId]: { ...environment, fetchRevision: environment.fetchRevision + 1 },
        },
      };
    }),
}));

export function selectLinearSection(
  byEnvironment: Record<string, LinearPanelEnvironmentState>,
  environmentId: string,
  status: LinearIssueStatus,
): LinearSectionState {
  return byEnvironment[environmentId]?.sections[status] ?? EMPTY_SECTION;
}

export function selectLinearFetchRevision(
  byEnvironment: Record<string, LinearPanelEnvironmentState>,
  environmentId: string,
): number {
  return byEnvironment[environmentId]?.fetchRevision ?? 0;
}
