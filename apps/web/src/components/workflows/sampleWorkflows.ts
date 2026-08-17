import type { WorkflowDefinition, WorkflowProjectState, WorkflowRun } from "~/workflowsStore";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A project's worth of stand-in workflows, one or more per panel section, for tests and for
 * looking at every bubble state before real workflows exist. Timestamps hang off `nowMs` so
 * relative labels ("Started 12m ago", "Runs in 6h") stay alive whenever it is loaded. Nothing
 * in the components imports this; load it into the store yourself, e.g.
 * `useWorkflowsStore.setState({ byProjectKey: { [key]: createSampleWorkflows(Date.now()) } })`.
 */
export function createSampleWorkflows(nowMs: number): WorkflowProjectState {
  const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();
  const definition = (
    id: string,
    name: string,
    description: string,
    createdOffsetMs: number,
    scheduledFor: string | null = null,
  ): WorkflowDefinition => ({
    id,
    name,
    description,
    createdAt: at(createdOffsetMs),
    updatedAt: at(createdOffsetMs),
    scheduledFor,
  });
  const run = (
    id: string,
    definitionId: string,
    fields: Omit<WorkflowRun, "id" | "definitionId">,
  ): WorkflowRun => ({ id, definitionId, ...fields });
  const doneRun = (
    id: string,
    definitionId: string,
    startedOffsetMs: number,
    durationMs: number,
    tokens: number,
    summary: string,
  ) =>
    run(id, definitionId, {
      status: "done",
      startedAt: at(startedOffsetMs),
      finishedAt: at(startedOffsetMs + durationMs),
      pausedAt: null,
      stage: null,
      progress: 1,
      tokens,
      summary,
    });

  return {
    definitions: [
      definition(
        "sample-audit",
        "Nightly audit",
        "Sweep the repo for flaky tests and file an issue per offender.",
        -6 * DAY,
        at(6 * HOUR),
      ),
      definition(
        "sample-release-notes",
        "Release notes",
        "Draft release notes from the PRs merged since the last tag.",
        -5 * DAY,
      ),
      definition(
        "sample-dep-bump",
        "Dependency bump",
        "Bump minor dependencies, run the suite, open a PR if it stays green.",
        -4 * DAY,
      ),
      definition(
        "sample-auth-refactor",
        "Auth refactor",
        "Split the session store out of the auth module without changing behaviour.",
        -3 * DAY,
      ),
      definition(
        "sample-docs-sweep",
        "Docs sweep",
        "Fix broken links and stale source paths under docs/.",
        -2 * DAY,
      ),
    ],
    runs: [
      run("sample-run-release-notes", "sample-release-notes", {
        status: "in-progress",
        startedAt: at(-12 * MINUTE),
        finishedAt: null,
        pausedAt: null,
        stage: "Researching",
        progress: 0.35,
        tokens: 84_200,
        summary: "Reading the 14 PRs merged since v1.4.0 and grouping them by area.",
      }),
      run("sample-run-dep-bump", "sample-dep-bump", {
        status: "in-progress",
        startedAt: at(-40 * MINUTE),
        finishedAt: null,
        pausedAt: at(-3 * MINUTE),
        stage: "Testing",
        progress: 0.7,
        tokens: 212_000,
        summary: "Bumped 9 packages; paused before running the web test suite.",
      }),
      run("sample-run-auth-refactor", "sample-auth-refactor", {
        status: "review",
        startedAt: at(-2 * HOUR),
        finishedAt: at(-20 * MINUTE),
        pausedAt: null,
        stage: null,
        progress: 1,
        tokens: 1_340_000,
        summary: "3 files changed, 42 tests green. Ready for a look.",
      }),
      run("sample-run-audit", "sample-audit", {
        status: "stuck",
        startedAt: at(-3 * HOUR),
        finishedAt: null,
        pausedAt: null,
        stage: "Testing",
        progress: 0.55,
        tokens: 410_000,
        summary: "vp test exited 1 twice in a row on apps/server; needs a human.",
      }),
      doneRun(
        "sample-run-docs-1",
        "sample-docs-sweep",
        -1 * DAY,
        22 * MINUTE,
        61_000,
        "Fixed 9 links and 2 stale paths.",
      ),
      doneRun(
        "sample-run-docs-2",
        "sample-docs-sweep",
        -2 * DAY,
        19 * MINUTE,
        48_500,
        "Fixed 4 links; nothing stale.",
      ),
      doneRun(
        "sample-run-release-notes-old",
        "sample-release-notes",
        -3 * DAY,
        25 * MINUTE,
        97_000,
        "Drafted notes for v1.4.0.",
      ),
      doneRun(
        "sample-run-docs-3",
        "sample-docs-sweep",
        -4 * DAY,
        21 * MINUTE,
        55_300,
        "Fixed 12 links and 1 stale path.",
      ),
    ],
  };
}
