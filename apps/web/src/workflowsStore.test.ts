import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createStartNode,
  findWorkflowRun,
  migratePersistedWorkflows,
  selectActiveWorkflowRuns,
  selectProjectWorkflows,
  useWorkflowsStore,
  WORKFLOW_RUN_HISTORY_LIMIT,
  type WorkflowRun,
} from "./workflowsStore";

const PROJECT_REF = scopeProjectRef(
  EnvironmentId.make("environment-1"),
  ProjectId.make("project-1"),
);
const OTHER_PROJECT_REF = scopeProjectRef(
  EnvironmentId.make("environment-1"),
  ProjectId.make("project-2"),
);

describe("workflowsStore", () => {
  beforeEach(() => useWorkflowsStore.setState({ byProjectKey: {} }));

  it("adds a definition with a trimmed name, a normalized colour and a Start → Report graph", () => {
    const definition = useWorkflowsStore
      .getState()
      .addDefinition(PROJECT_REF, { name: "  Nightly audit  ", description: "  ", color: "#ABC" });

    expect(definition.name).toBe("Nightly audit");
    expect(definition.description).toBeNull();
    expect(definition.color).toBe("#aabbcc");
    expect(definition.sharedContext).toBe("");
    expect(definition.nodes.map((node) => node.kind)).toEqual(["start", "end"]);
    expect(definition.scheduledFor).toBeNull();
    expect(definition.createdAt).toBe(definition.updatedAt);
    const project = selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF);
    expect(project.definitions).toEqual([definition]);
    expect(project.runs).toEqual([]);
  });

  it("updates, duplicates with fresh node ids, and removes definitions", () => {
    const store = useWorkflowsStore.getState();
    const lane = createAgentNode("agent", { prompt: "x" });
    const original = store.addDefinition(PROJECT_REF, {
      name: "First",
      nodes: [createStartNode(), createFanOutNode({ lane: [lane] }), createEndNode()],
    });
    store.updateDefinition(PROJECT_REF, original.id, { name: "  Renamed ", color: "not-a-colour" });
    const renamed = selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF)
      .definitions[0]!;
    expect(renamed.name).toBe("Renamed");
    expect(renamed.color).toBe("#22d3ee");
    expect(renamed.updatedAt >= original.updatedAt).toBe(true);

    const copy = store.duplicateDefinition(PROJECT_REF, original.id)!;
    expect(copy.name).toBe("Renamed copy");
    expect(copy.nodes.map((node) => node.kind)).toEqual(["start", "fan-out", "end"]);
    const copiedLane = copy.nodes[1]!.kind === "fan-out" ? copy.nodes[1]!.lane[0]! : null;
    expect(copiedLane?.id).not.toBe(lane.id);
    expect(copy.nodes[0]!.id).not.toBe(original.nodes[0]!.id);

    store.removeDefinition(PROJECT_REF, original.id);
    const project = selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF);
    expect(project.definitions.map((definition) => definition.id)).toEqual([copy.id]);
  });

  it("creates runs that freeze the graph, patches them by id across projects, and prunes history", () => {
    const store = useWorkflowsStore.getState();
    const definition = store.addDefinition(PROJECT_REF, { name: "Flow" });
    const run = store.createRun(PROJECT_REF, definition);
    expect(run.snapshot.nodes).toBe(definition.nodes);
    expect(run.status).toBe("in-progress");
    expect(findWorkflowRun(useWorkflowsStore.getState().byProjectKey, run.id)).toEqual(run);
    expect(selectActiveWorkflowRuns(useWorkflowsStore.getState().byProjectKey)).toEqual([run]);

    store.patchRun(run.id, (current) => ({
      ...current,
      status: "done",
      finishedAt: "2026-08-17T11:00:00.000Z",
    }));
    expect(findWorkflowRun(useWorkflowsStore.getState().byProjectKey, run.id)?.status).toBe("done");
    expect(selectActiveWorkflowRuns(useWorkflowsStore.getState().byProjectKey)).toEqual([]);

    store.setInstance(run.id, { key: "n:0", nodeId: "n", iteration: 0, status: "done" });
    expect(
      findWorkflowRun(useWorkflowsStore.getState().byProjectKey, run.id)?.instances["n:0"]?.status,
    ).toBe("done");

    for (let index = 0; index < WORKFLOW_RUN_HISTORY_LIMIT + 3; index += 1) {
      const extra = store.createRun(PROJECT_REF, definition);
      store.patchRun(extra.id, (current) => ({
        ...current,
        status: "done",
        finishedAt: `2026-08-18T${String(index).padStart(2, "0")}:00:00.000Z`,
      }));
    }
    store.pruneRuns(PROJECT_REF);
    const project = selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF);
    expect(project.runs).toHaveLength(WORKFLOW_RUN_HISTORY_LIMIT);
    // The oldest finished run (the first one) is what got dropped.
    expect(project.runs.find((entry) => entry.id === run.id)).toBeUndefined();
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

  it("migrates v1 state: definitions get a blank graph and colour, v1 runs are dropped", () => {
    const legacyRun = {
      id: "run-1",
      definitionId: "definition-1",
      status: "in-progress",
      startedAt: "2026-08-17T10:00:00.000Z",
      finishedAt: null,
    } as unknown as WorkflowRun;
    const migrated = migratePersistedWorkflows(
      {
        byProjectKey: {
          "environment-1:project-1": {
            definitions: [
              {
                id: "definition-1",
                name: "Legacy",
                description: null,
                createdAt: "2026-08-17T10:00:00.000Z",
                updatedAt: "2026-08-17T10:00:00.000Z",
                scheduledFor: null,
              },
            ],
            runs: [legacyRun],
          },
        },
      },
      1,
    );
    const project = migrated.byProjectKey["environment-1:project-1"]!;
    expect(project.definitions[0]).toMatchObject({
      id: "definition-1",
      color: "#22d3ee",
      sharedContext: "",
    });
    expect(project.definitions[0]!.nodes.map((node) => node.kind)).toEqual(["start", "end"]);
    expect(project.runs).toEqual([]);
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
