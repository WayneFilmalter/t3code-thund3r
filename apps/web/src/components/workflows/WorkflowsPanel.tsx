import type { ScopedProjectRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { newMessageId } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { requestConfirmDialog } from "~/confirmDialog";
import { findWorkflowTemplate } from "~/workflows/workflowTemplates";
import { getWorkflowRunner } from "~/workflows/workflowRunnerSingleton";
import {
  findWorkflowRun,
  selectProjectWorkflows,
  useWorkflowsStore,
  type WorkflowDefinition,
  type WorkflowInstanceThread,
} from "~/workflowsStore";

import { WorkflowBuilderPanel, type WorkflowBuilderTarget } from "./WorkflowBuilderPanel";
import type { WorkflowDefinitionMenuAction } from "./WorkflowBubble";
import { WorkflowHistoryPanel } from "./WorkflowHistoryPanel";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import { WorkflowsListView } from "./WorkflowsListView";
import { deriveTasks, workflowThreadIds, type TaskItem } from "./taskItems";
import {
  deriveWorkflowSections,
  type WorkflowBubbleAction,
  type WorkflowSectionItem,
} from "./workflowsPanel.logic";

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
  const projectRefs = useMemo(() => (projectRef ? [projectRef] : []), [projectRef]);
  const shells = useThreadShellsForProjectRefs(projectRefs);
  const tasks = useMemo(
    () =>
      deriveTasks(shells, { nowMs: Date.now(), excludeThreadIds: workflowThreadIds(project.runs) }),
    [shells, project.runs],
  );
  const sections = useMemo(() => deriveWorkflowSections(project, tasks), [project, tasks]);
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn);
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

  const startDefinition = (definition: WorkflowDefinition) => {
    if (!projectRef) return;
    const run = getWorkflowRunner().startRun(projectRef, definition);
    if (run) enterWide({ kind: "run", runId: run.id });
    else enterWide({ kind: "builder", target: { kind: "existing", definition } });
  };

  const handleMenuAction = (item: WorkflowSectionItem, action: WorkflowDefinitionMenuAction) => {
    if (!projectRef || item.kind !== "definition") return;
    const { definition } = item;
    const store = useWorkflowsStore.getState();
    switch (action) {
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
            { variant: "destructive" },
          );
          if (confirmed === false) return;
          store.removeDefinition(projectRef, definition.id);
        })();
        return;
    }
  };

  const handleTaskAction = (task: TaskItem, action: WorkflowBubbleAction) => {
    const { environmentId, threadId } = task.ref;
    switch (action) {
      case "view":
        void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
        return;
      case "stop":
        void interruptTurn({ environmentId, input: { threadId } });
        return;
      case "resume": {
        // A follow-up turn on the thread with what it already had: same model, mode, permissions.
        const shell = shells.find((candidate) => candidate.id === threadId);
        if (!shell) return;
        void startTurn({
          environmentId,
          input: {
            threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: "Continue where you left off.",
              attachments: [],
            },
            modelSelection: shell.modelSelection,
            runtimeMode: shell.runtimeMode,
            interactionMode: shell.interactionMode,
            createdAt: new Date().toISOString(),
          },
        });
        return;
      }
      default:
        return;
    }
  };

  const handleAction = (item: WorkflowSectionItem, action: WorkflowBubbleAction) => {
    const runner = getWorkflowRunner();
    if (item.kind === "task") {
      handleTaskAction(item.task, action);
      return;
    }
    if (item.kind === "definition") {
      if (action === "start") startDefinition(item.definition);
      return;
    }
    const { run } = item;
    switch (action) {
      case "view":
        enterWide({ kind: "run", runId: run.id });
        return;
      case "stop":
        runner.cancelRun(run.id);
        return;
      case "pause":
        runner.pauseRun(run.id);
        return;
      case "resume":
        runner.resumeRun(run.id);
        return;
      case "restart": {
        // Prefer the definition as it is now; fall back to the graph the run was started with.
        const current = project.definitions.find(
          (definition) => definition.id === run.definitionId,
        );
        const next = current
          ? projectRef
            ? runner.startRun(projectRef, current)
            : null
          : runner.restartRun(run.id);
        if (next) enterWide({ kind: "run", runId: next.id });
        return;
      }
      case "approve":
        runner.approveReview(run.id);
        return;
      case "reject":
        runner.rejectReview(run.id);
        return;
      case "start":
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
        onPause={() => getWorkflowRunner().pauseRun(activeRun.id)}
        onResume={() => getWorkflowRunner().resumeRun(activeRun.id)}
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
        onAction={handleAction}
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
      onAction={handleAction}
      onMenuAction={handleMenuAction}
    />
  );
}
