import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { createSampleWorkflows } from "./sampleWorkflows";
import { WorkflowBuilderPanel } from "./WorkflowBuilderPanel";
import { WorkflowHistoryPanel } from "./WorkflowHistoryPanel";
import { WorkflowsListView } from "./WorkflowsPanel";
import { DONE_PREVIEW_COUNT, deriveWorkflowSections } from "./workflowsPanel.logic";

const noop = () => undefined;

describe("WorkflowsListView", () => {
  it("asks for a project when the thread has none", () => {
    const html = renderToStaticMarkup(
      <WorkflowsListView
        hasProject={false}
        sections={[]}
        onCreate={noop}
        onViewHistory={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain("No project selected");
    expect(html).toContain('aria-label="New workflow"');
    expect(html).toContain("disabled");
  });

  it("shows only the empty state and create button when the project has no workflows", () => {
    const html = renderToStaticMarkup(
      <WorkflowsListView
        hasProject
        sections={[]}
        onCreate={noop}
        onViewHistory={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain("No workflows yet");
    expect(html).toContain('aria-label="New workflow"');
    expect(html.match(/New workflow/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('aria-label="Workflows"');
    expect(html).not.toContain("In progress");
  });

  it("renders only the sections that have something in them", () => {
    const sections = deriveWorkflowSections({
      definitions: [
        {
          id: "audit",
          name: "Nightly audit",
          description: "Sweep the repo for flaky tests",
          createdAt: "2026-08-17T10:00:00.000Z",
          updatedAt: "2026-08-17T10:00:00.000Z",
          scheduledFor: "2036-08-18T10:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run-1",
          definitionId: "audit",
          status: "in-progress",
          startedAt: "2026-08-17T11:00:00.000Z",
          finishedAt: null,
          pausedAt: null,
          stage: null,
          progress: null,
          tokens: 0,
          summary: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      <WorkflowsListView
        hasProject
        sections={sections}
        onCreate={noop}
        onViewHistory={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain('aria-label="Workflows"');
    expect(html).toContain('aria-label="Scheduled"');
    expect(html).toContain('aria-label="In progress"');
    expect(html).not.toContain('aria-label="Review"');
    expect(html).not.toContain('aria-label="Stuck"');
    expect(html).not.toContain('aria-label="Done"');
    expect(html).not.toContain("View all");
    expect(html).toContain("Nightly audit");
    expect(html).toContain("Sweep the repo for flaky tests");
    expect(html).not.toContain("No workflows yet");
  });

  it("previews the latest finished runs under Done with a View all into history", () => {
    const doneRun = (id: string, day: number) => ({
      id,
      definitionId: "audit",
      status: "done" as const,
      startedAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      finishedAt: `2026-08-${String(day).padStart(2, "0")}T10:20:00.000Z`,
      pausedAt: null,
      stage: null,
      progress: 1,
      tokens: 1_000,
      summary: null,
    });
    const sections = deriveWorkflowSections({
      definitions: [
        {
          id: "audit",
          name: "Nightly audit",
          description: null,
          createdAt: "2026-08-01T10:00:00.000Z",
          updatedAt: "2026-08-01T10:00:00.000Z",
          scheduledFor: null,
        },
      ],
      runs: [doneRun("d1", 1), doneRun("d2", 2), doneRun("d3", 3), doneRun("d4", 4)],
    });

    const html = renderToStaticMarkup(
      <WorkflowsListView
        hasProject
        sections={sections}
        onCreate={noop}
        onViewHistory={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain("View all");
    expect(html.match(/Nightly audit/g)?.length).toBe(1 + DONE_PREVIEW_COUNT);

    const history = renderToStaticMarkup(
      <WorkflowHistoryPanel
        items={sections.find((section) => section.id === "done")!.items}
        timestampFormat="24-hour"
        onBack={noop}
        onAction={noop}
      />,
    );
    expect(history).toContain("History");
    expect(history.match(/Nightly audit/g)?.length).toBe(4);
    expect(history).toContain("· 20m");
    expect(history.match(/>View</g)?.length).toBe(4);
  });

  it("gives every section its bubble: progress, stage, tokens, body, and the right actions", () => {
    const sections = deriveWorkflowSections(createSampleWorkflows(Date.UTC(2026, 7, 17, 12)));
    const bySection = Object.fromEntries(
      sections.map((section) => [
        section.id,
        renderToStaticMarkup(
          <WorkflowsListView
            hasProject
            sections={[section]}
            onCreate={noop}
            onViewHistory={noop}
            onAction={noop}
          />,
        ),
      ]),
    );

    expect(bySection.workflows).toContain(">Schedule<");
    expect(bySection.workflows).toContain(">Start<");
    expect(bySection.workflows).not.toContain("tokens");
    expect(bySection.workflows).not.toContain('role="progressbar"');

    expect(bySection.scheduled).toContain(">Unschedule<");
    expect(bySection.scheduled).toContain(">Start<");
    expect(bySection.scheduled).toContain("Runs in");

    expect(bySection["in-progress"]).toContain(">Pause<");
    expect(bySection["in-progress"]).toContain(">Resume<");
    expect(bySection["in-progress"]).toContain(">Researching<");
    expect(bySection["in-progress"]).toContain(">Paused<");
    expect(bySection["in-progress"]).toContain('role="progressbar"');
    expect(bySection["in-progress"]).toContain("35%");
    expect(bySection["in-progress"]).toContain("84k tokens");
    expect(bySection["in-progress"]).toContain("Reading the 14 PRs merged since v1.4.0");

    expect(bySection.review).toContain(">View<");
    expect(bySection.review).toContain("1.3m tokens");
    expect(bySection.review).toContain("Ready for a look.");

    expect(bySection.stuck).toContain(">Restart<");
    expect(bySection.stuck).toContain(">Testing<");
    expect(bySection.stuck).toContain("needs a human");

    expect(bySection.done).toContain(">View<");
    expect(bySection.done).toContain("Finished");
  });

  it("frames the builder with a back button", () => {
    const html = renderToStaticMarkup(<WorkflowBuilderPanel onBack={() => undefined} />);
    expect(html).toContain("Build workflow");
    expect(html).toContain("Back");
  });
});
