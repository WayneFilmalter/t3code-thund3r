import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectProjectWorkflows, useWorkflowsStore, type WorkflowRun } from "./workflowsStore";

const PROJECT_REF = scopeProjectRef(
  EnvironmentId.make("environment-1"),
  ProjectId.make("project-1"),
);
const OTHER_PROJECT_REF = scopeProjectRef(
  EnvironmentId.make("environment-1"),
  ProjectId.make("project-2"),
);

const run: WorkflowRun = {
  id: "run-1",
  definitionId: "definition-1",
  status: "in-progress",
  startedAt: "2026-08-17T10:00:00.000Z",
  finishedAt: null,
};

describe("workflowsStore", () => {
  beforeEach(() => useWorkflowsStore.setState({ byProjectKey: {} }));

  it("adds a definition to its project with a trimmed name and no schedule", () => {
    const definition = useWorkflowsStore
      .getState()
      .addDefinition(PROJECT_REF, { name: "  Nightly audit  ", description: "  " });

    expect(definition.name).toBe("Nightly audit");
    expect(definition.description).toBeNull();
    expect(definition.scheduledFor).toBeNull();
    expect(definition.createdAt).toBe(definition.updatedAt);
    const project = selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF);
    expect(project.definitions).toEqual([definition]);
    expect(project.runs).toEqual([]);
  });

  it("removes only the named definition and leaves runs and other projects alone", () => {
    const first = useWorkflowsStore.getState().addDefinition(PROJECT_REF, { name: "First" });
    const second = useWorkflowsStore.getState().addDefinition(PROJECT_REF, { name: "Second" });
    const other = useWorkflowsStore.getState().addDefinition(OTHER_PROJECT_REF, { name: "Other" });
    useWorkflowsStore.setState((state) => ({
      byProjectKey: {
        ...state.byProjectKey,
        [`${PROJECT_REF.environmentId}:${PROJECT_REF.projectId}`]: {
          definitions: [first, second],
          runs: [run],
        },
      },
    }));

    useWorkflowsStore.getState().removeDefinition(PROJECT_REF, first.id);

    const project = selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF);
    expect(project.definitions).toEqual([second]);
    expect(project.runs).toEqual([run]);
    expect(
      selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, OTHER_PROJECT_REF)
        .definitions,
    ).toEqual([other]);
  });

  it("drops a whole project and ignores unknown ones", () => {
    useWorkflowsStore.getState().addDefinition(PROJECT_REF, { name: "First" });
    const before = useWorkflowsStore.getState();
    useWorkflowsStore.getState().removeProject(OTHER_PROJECT_REF);
    expect(useWorkflowsStore.getState()).toBe(before);

    useWorkflowsStore.getState().removeProject(PROJECT_REF);
    expect(useWorkflowsStore.getState().byProjectKey).toEqual({});
  });

  it("returns one shared empty state for unknown or missing projects", () => {
    const { byProjectKey } = useWorkflowsStore.getState();
    const missing = selectProjectWorkflows(byProjectKey, null);
    expect(missing).toEqual({ definitions: [], runs: [] });
    expect(selectProjectWorkflows(byProjectKey, PROJECT_REF)).toBe(missing);
  });

  it("persists definitions per project and restores them", async () => {
    const definition = useWorkflowsStore.getState().addDefinition(PROJECT_REF, { name: "Kept" });

    const { name, storage, partialize } = useWorkflowsStore.persist.getOptions();
    if (!name) throw new Error("Expected workflows persistence to have a storage name");
    expect(partialize?.(useWorkflowsStore.getState())).toEqual({
      byProjectKey: useWorkflowsStore.getState().byProjectKey,
    });
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({
      byProjectKey: {
        [`${PROJECT_REF.environmentId}:${PROJECT_REF.projectId}`]: {
          definitions: [definition],
        },
      },
    });

    useWorkflowsStore.setState({ byProjectKey: {} });
    if (persisted) await storage?.setItem(name, persisted);
    await useWorkflowsStore.persist.rehydrate();

    expect(
      selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF).definitions,
    ).toEqual([definition]);
  });
});
