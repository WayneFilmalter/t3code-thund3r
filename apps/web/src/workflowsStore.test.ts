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
  pausedAt: null,
  stage: "Researching",
  progress: 0.35,
  tokens: 84_200,
  summary: "Reading merged PRs.",
};

const PROJECT_KEY = `${PROJECT_REF.environmentId}:${PROJECT_REF.projectId}`;
const project = () =>
  selectProjectWorkflows(useWorkflowsStore.getState().byProjectKey, PROJECT_REF);

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
        [PROJECT_KEY]: {
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

  it("schedules and unschedules a definition, bumping updatedAt", () => {
    const definition = useWorkflowsStore.getState().addDefinition(PROJECT_REF, { name: "Audit" });
    useWorkflowsStore
      .getState()
      .setSchedule(PROJECT_REF, definition.id, "2036-08-18T10:00:00.000Z");
    expect(project().definitions[0]).toMatchObject({ scheduledFor: "2036-08-18T10:00:00.000Z" });
    expect(project().definitions[0]!.updatedAt >= definition.updatedAt).toBe(true);

    useWorkflowsStore.getState().setSchedule(PROJECT_REF, definition.id, null);
    expect(project().definitions[0]!.scheduledFor).toBeNull();

    const before = useWorkflowsStore.getState();
    useWorkflowsStore.getState().setSchedule(PROJECT_REF, "missing", null);
    expect(useWorkflowsStore.getState()).toBe(before);
  });

  it("starts a run in progress at the planning stage with no tokens spent", () => {
    const started = useWorkflowsStore.getState().startRun(PROJECT_REF, "definition-1");
    expect(started).toMatchObject({
      definitionId: "definition-1",
      status: "in-progress",
      finishedAt: null,
      pausedAt: null,
      stage: "Planning",
      progress: 0,
      tokens: 0,
      summary: null,
    });
    expect(project().runs).toEqual([started]);
  });

  it("pauses and resumes only in-progress runs", () => {
    useWorkflowsStore.setState({
      byProjectKey: {
        [PROJECT_KEY]: { definitions: [], runs: [run, { ...run, id: "run-2", status: "review" }] },
      },
    });

    useWorkflowsStore.getState().pauseRun(PROJECT_REF, "run-1");
    expect(project().runs[0]!.pausedAt).not.toBeNull();
    const paused = useWorkflowsStore.getState();
    useWorkflowsStore.getState().pauseRun(PROJECT_REF, "run-1");
    useWorkflowsStore.getState().pauseRun(PROJECT_REF, "run-2");
    expect(useWorkflowsStore.getState()).toBe(paused);
    expect(project().runs[1]!.pausedAt).toBeNull();

    useWorkflowsStore.getState().resumeRun(PROJECT_REF, "run-1");
    expect(project().runs[0]!.pausedAt).toBeNull();
    expect(project().runs[0]!.status).toBe("in-progress");
  });

  it("restarts a stuck run from zero progress but keeps its tokens", () => {
    useWorkflowsStore.setState({
      byProjectKey: {
        [PROJECT_KEY]: {
          definitions: [],
          runs: [{ ...run, status: "stuck", progress: 0.55, tokens: 410_000, pausedAt: "x" }],
        },
      },
    });

    useWorkflowsStore.getState().restartRun(PROJECT_REF, "run-1");
    expect(project().runs[0]).toMatchObject({
      status: "in-progress",
      progress: 0,
      pausedAt: null,
      finishedAt: null,
      tokens: 410_000,
    });
    expect(project().runs[0]!.startedAt > run.startedAt).toBe(true);

    const restarted = useWorkflowsStore.getState();
    useWorkflowsStore.getState().restartRun(PROJECT_REF, "run-1");
    expect(useWorkflowsStore.getState()).toBe(restarted);
  });

  it("fills in run fields added after v1 when migrating persisted state", () => {
    const { migrate } = useWorkflowsStore.persist.getOptions();
    const { pausedAt: _p, stage: _s, progress: _g, tokens: _t, summary: _u, ...legacyRun } = run;
    const migrated = migrate?.(
      { byProjectKey: { [PROJECT_KEY]: { definitions: [], runs: [legacyRun] } } },
      1,
    ) as { byProjectKey: Record<string, { runs: WorkflowRun[] }> };
    expect(migrated.byProjectKey[PROJECT_KEY]!.runs[0]).toEqual({
      ...legacyRun,
      pausedAt: null,
      stage: null,
      progress: null,
      tokens: 0,
      summary: null,
    });
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
        [PROJECT_KEY]: {
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
