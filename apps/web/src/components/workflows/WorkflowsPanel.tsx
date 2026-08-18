import type { ScopedProjectRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { findWorkflowTemplate } from "~/workflows/workflowTemplates";
import { getWorkflowRunner } from "~/workflows/workflowRunnerSingleton";
import {
  findWorkflowRun,
  selectProjectWorkflows,
  useWorkflowsStore,
  type WorkflowDefinition,
  type WorkflowInstanceThread,
  type WorkflowRun,
} from "~/workflowsStore";

import { WorkflowBuilderPanel, type WorkflowBuilderTarget } from "./WorkflowBuilderPanel";
import { WorkflowHistoryPanel } from "./WorkflowHistoryPanel";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import {
  WorkflowsListView,
  type WorkflowDefinitionAction,
  type WorkflowRunAction,
} from "./WorkflowsListView";
import { deriveWorkflowSections } from "./workflowsPanel.logic";

type PanelMode =
  | { kind: "list" }
  | { kind: "history" }
  | { kind: "builder"; target: WorkflowBuilderTarget }
  | { kind: "run"; runId: string };

/**
 * Workflows right-panel surface: the project's built workflows, grouped by state, and the
 * entry points into the builder and into a run. Workflows are project-scoped, so every thread
 * in a project sees the same list. Entering the builder or a run maximizes the panel (when the
 * host allows) and Back restores it.
 */
export function WorkflowsPanel({
  projectRef,
  timestampFormat,
  maximized = false,
  onSetMaximized,
}: {
  projectRef: ScopedProjectRef | null;
  timestampFormat: TimestampFormat;
  maximized?: boolean;
  onSetMaximized?: ((maximized: boolean) => void) | undefined;
}) {
  const [mode, setMode] = useState<PanelMode>({ kind: "list" });
  const navigate = useNavigate();
  const project = useWorkflowsStore((state) =>
    selectProjectWorkflows(state.byProjectKey, projectRef),
  );
  const activeRun = useWorkflowsStore((state) =>
    mode.kind === "run" ? findWorkflowRun(state.byProjectKey, mode.runId) : null,
  );
  const sections = useMemo(() => deriveWorkflowSections(project), [project]);
  const busyDefinitionIds = useMemo(
    () =>
      new Set(
        project.runs
          .filter((run) => run.status === "in-progress" || run.status === "review")
          .map((run) => run.definitionId),
      ),
    [project.runs],
  );
  const restoreMaximized = useRef<boolean | null>(null);

  const enterWide = (next: PanelMode) => {
    if (restoreMaximized.current === null) restoreMaximized.current = maximized;
    onSetMaximized?.(true);
    setMode(next);
  };
  const backToList = () => {
    if (restoreMaximized.current !== null) {
      onSetMaximized?.(restoreMaximized.current);
      restoreMaximized.current = null;
    }
    setMode({ kind: "list" });
  };

  // A run that disappears (pruned or the project switched) drops us back to the list.
  useEffect(() => {
    if (mode.kind === "run" && activeRun === null) setMode({ kind: "list" });
  }, [mode, activeRun]);

  const handleDefinitionAction = (
    definition: WorkflowDefinition,
    action: WorkflowDefinitionAction,
  ) => {
    if (!projectRef) return;
    const store = useWorkflowsStore.getState();
    switch (action) {
      case "start": {
        const run = getWorkflowRunner().startRun(projectRef, definition);
        if (run) enterWide({ kind: "run", runId: run.id });
        else enterWide({ kind: "builder", target: { kind: "existing", definition } });
        return;
      }
      case "edit":
        enterWide({ kind: "builder", target: { kind: "existing", definition } });
        return;
      case "duplicate":
        store.duplicateDefinition(projectRef, definition.id);
        return;
      case "delete":
        void (async () => {
          const confirmed = await requestConfirmDialog(
            `Delete the workflow "${definition.name}"?`,
            {
              variant: "destructive",
            },
          );
          if (confirmed === false) return;
          store.removeDefinition(projectRef, definition.id);
        })();
        return;
    }
  };

  const handleRunAction = (run: WorkflowRun, action: WorkflowRunAction) => {
    const runner = getWorkflowRunner();
    switch (action) {
      case "open":
        enterWide({ kind: "run", runId: run.id });
        return;
      case "stop":
        runner.cancelRun(run.id);
        return;
      case "approve":
        runner.approveReview(run.id);
        return;
      case "reject":
        runner.rejectReview(run.id);
        return;
    }
  };

  const openThread = (thread: WorkflowInstanceThread) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.threadId },
    });
  };

  if (mode.kind === "builder" && projectRef) {
    return (
      <WorkflowBuilderPanel
        key={mode.target.kind === "existing" ? mode.target.definition.id : "new"}
        projectRef={projectRef}
        target={mode.target}
        maximized={maximized}
        onSetMaximized={onSetMaximized}
        onBack={backToList}
        onSaved={backToList}
      />
    );
  }
  if (mode.kind === "run" && activeRun) {
    return (
      <WorkflowRunPanel
        run={activeRun}
        maximized={maximized}
        onSetMaximized={onSetMaximized}
        onBack={backToList}
        onStop={() => getWorkflowRunner().cancelRun(activeRun.id)}
        onApprove={() => getWorkflowRunner().approveReview(activeRun.id)}
        onReject={() => getWorkflowRunner().rejectReview(activeRun.id)}
        onOpenThread={openThread}
      />
    );
  }
  if (mode.kind === "history") {
    return (
      <WorkflowHistoryPanel
        items={sections.find((section) => section.id === "done")?.items ?? []}
        timestampFormat={timestampFormat}
        onBack={() => setMode({ kind: "list" })}
      />
    );
  }
  return (
    <WorkflowsListView
      hasProject={projectRef !== null}
      sections={sections}
      busyDefinitionIds={busyDefinitionIds}
      onCreate={(templateId) => {
        const template = findWorkflowTemplate(templateId) ?? findWorkflowTemplate("blank")!;
        enterWide({ kind: "builder", target: { kind: "new", input: template.build() } });
      }}
      onViewHistory={() => setMode({ kind: "history" })}
      onDefinitionAction={handleDefinitionAction}
      onRunAction={handleRunAction}
    />
  );
}
