import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createStartNode,
} from "~/workflowsStore";
import { findWorkflowTemplate } from "~/workflows/workflowTemplates";

import { WorkflowBuilderPanel } from "./WorkflowBuilderPanel";
import { WorkflowHistoryPanel } from "./WorkflowHistoryPanel";
import { WorkflowsListView, definitionSummary } from "./WorkflowsListView";
import { DONE_PREVIEW_COUNT, deriveWorkflowSections } from "./workflowsPanel.logic";
import { definition, run } from "./workflowsPanel.logic.test";

const noop = () => undefined;
const PROJECT_REF = scopeProjectRef(EnvironmentId.make("env"), ProjectId.make("project"));

describe("WorkflowsListView", () => {
  it("asks for a project when the thread has none", () => {
    const html = renderToStaticMarkup(
      <WorkflowsListView hasProject={false} sections={[]} onCreate={noop} onViewHistory={noop} />,
    );
    expect(html).toContain("No project selected");
    expect(html).toContain('aria-label="New workflow"');
    expect(html).toContain("disabled");
  });

  it("shows only the empty state and create button when the project has no workflows", () => {
    const html = renderToStaticMarkup(
      <WorkflowsListView hasProject sections={[]} onCreate={noop} onViewHistory={noop} />,
    );
    expect(html).toContain("No workflows yet");
    expect(html).toContain('aria-label="New workflow"');
    expect(html.match(/New workflow/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('aria-label="Workflows"');
    expect(html).not.toContain("In progress");
  });

  it("renders only the sections that have something in them, with coloured workflow bubbles", () => {
    const sections = deriveWorkflowSections({
      definitions: [
        definition({
          id: "audit",
          name: "Nightly audit",
          description: "Sweep the repo for flaky tests",
          color: "#a78bfa",
          scheduledFor: "2036-08-18T10:00:00.000Z",
        }),
      ],
      runs: [run({ id: "run-1", definitionId: "audit" })],
    });

    const html = renderToStaticMarkup(
      <WorkflowsListView
        hasProject
        sections={sections}
        onCreate={noop}
        onViewHistory={noop}
        onAction={noop}
        onMenuAction={noop}
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
    expect(html).toContain("#a78bfa");
    expect(html).toContain('aria-label="Start Nightly audit"');
    expect(html).toContain('aria-label="Pause Nightly audit"');
    expect(html).toContain('aria-label="Stop Nightly audit"');
    expect(html).toContain('aria-label="Workflow actions"');
    expect(html).toMatch(/\d+\/\d+ steps · started/);
    expect(html).not.toContain("No workflows yet");
  });

  it("disables Start while the workflow already has a run going", () => {
    const sections = deriveWorkflowSections({
      definitions: [definition({ id: "audit", name: "Nightly audit" })],
      runs: [],
    });
    const html = renderToStaticMarkup(
      <WorkflowsListView
        hasProject
        sections={sections}
        busyDefinitionIds={new Set(["audit"])}
        onCreate={noop}
        onViewHistory={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain('aria-label="Already running"');
  });

  it("previews the latest finished runs under Done with a View all into history", () => {
    const doneRun = (id: string, day: number) =>
      run({
        id,
        definitionId: "audit",
        status: "done",
        startedAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`,
        finishedAt: `2026-08-${String(day).padStart(2, "0")}T10:20:00.000Z`,
      });
    const sections = deriveWorkflowSections({
      definitions: [definition({ id: "audit", name: "Nightly audit" })],
      runs: [doneRun("d1", 1), doneRun("d2", 2), doneRun("d3", 3), doneRun("d4", 4)],
    });

    const html = renderToStaticMarkup(
      <WorkflowsListView hasProject sections={sections} onCreate={noop} onViewHistory={noop} />,
    );
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain("View all");
    expect(html.match(/>Nightly audit</g)?.length).toBe(1 + DONE_PREVIEW_COUNT);

    const history = renderToStaticMarkup(
      <WorkflowHistoryPanel
        items={sections.find((section) => section.id === "done")!.items}
        timestampFormat="24-hour"
        onBack={noop}
        onAction={noop}
      />,
    );
    expect(history).toContain("History");
    expect(history.match(/>Nightly audit</g)?.length).toBe(4);
    expect(history).toContain("· 20m");
  });

  it("summarises a definition's shape", () => {
    expect(
      definitionSummary(
        definition({
          id: "x",
          nodes: [
            createStartNode({ mode: "loop", maxIterations: 3 }),
            createAgentNode("linear-agent"),
            createFanOutNode({ maxParallel: 5, lane: [createAgentNode("agent")] }),
            createEndNode(),
          ],
        }),
      ),
    ).toBe("3 steps · ×5 parallel · loop");
  });
});

describe("WorkflowBuilderPanel", () => {
  it("frames the builder with Back, the name, Save, and the template's bubbles", () => {
    const template = findWorkflowTemplate("backlog-follow-up")!;
    const html = renderToStaticMarkup(
      <WorkflowBuilderPanel
        projectRef={PROJECT_REF}
        target={{ kind: "new", input: template.build() }}
        maximized={false}
        onBack={noop}
        onSaved={noop}
      />,
    );
    expect(html).toContain("Back");
    expect(html).toContain('value="Backlog follow-up"');
    expect(html).toContain("Save");
    expect(html).toContain("Find untriaged tickets");
    expect(html).toContain("For each item");
    expect(html).toContain("Research ticket");
    expect(html).toContain('aria-label="Insert step"');
    expect(html).toContain("lane · per item");
  });
});
