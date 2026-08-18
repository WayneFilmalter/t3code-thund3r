import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { formatElapsedDurationLabel } from "~/timestampFormat";
import { WORKFLOW_NODE_META, workflowNodeTitle } from "~/workflows/workflowNodeMeta";
import {
  findNode,
  instanceKeyFor,
  outputAsList,
  outputAsText,
} from "~/workflows/workflowRunner.logic";
import type {
  WorkflowInstanceThread,
  WorkflowNode,
  WorkflowNodeInstance,
  WorkflowRun,
} from "~/workflowsStore";

import { WorkflowCanvas } from "./builder/WorkflowCanvas";
import type { NodeBubbleRunState } from "./builder/NodeBubble";
import { WorkflowsSubheader } from "./WorkflowsSubheader";
import { stuckReason } from "./workflowsPanel.logic";

const RUN_STATUS_LABELS: Record<WorkflowRun["status"], string> = {
  "in-progress": "Running",
  review: "Waiting for review",
  stuck: "Stuck",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

/** Instances of one node in the current iteration: one for chain nodes, one per lane otherwise. */
function instancesFor(run: WorkflowRun, nodeId: string): WorkflowNodeInstance[] {
  const single = run.instances[instanceKeyFor(nodeId, run.iteration)];
  if (single) return [single];
  return Object.values(run.instances)
    .filter((instance) => instance.nodeId === nodeId && instance.iteration === run.iteration)
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
}

function laneTotal(run: WorkflowRun, fanOutId: string): number | null {
  const nodes = run.snapshot.nodes;
  const index = nodes.findIndex((node) => node.id === fanOutId);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = nodes[cursor]!;
    if (candidate.kind === "prompt-block" || candidate.kind === "start") continue;
    const list = outputAsList(run.instances[instanceKeyFor(candidate.id, run.iteration)]?.output);
    return list?.length ?? null;
  }
  return null;
}

function runStateFor(run: WorkflowRun, nodeId: string): NodeBubbleRunState | undefined {
  const node = findNode(run.snapshot.nodes, nodeId);
  if (!node) return undefined;
  const instances = instancesFor(run, nodeId);
  if (node.kind === "fan-out") {
    const instance = instances[0];
    const total = laneTotal(run, nodeId);
    const done = countLaneDone(run, node);
    return {
      status: instance?.status ?? "idle",
      ...(total !== null && total > 0 ? { laneProgress: { done, total } } : {}),
    };
  }
  if (instances.length === 0) return { status: "idle" };
  if (instances.length === 1) return { status: instances[0]!.status };
  if (instances.some((instance) => instance.status === "running")) return { status: "running" };
  if (instances.some((instance) => instance.status === "waiting-review"))
    return { status: "waiting-review" };
  if (instances.some((instance) => instance.status === "failed")) return { status: "failed" };
  if (instances.every((instance) => instance.status === "done" || instance.status === "skipped")) {
    return { status: "done" };
  }
  return { status: "pending" };
}

/** Lanes whose last executing node is done (or that failed) count as finished. */
function countLaneDone(
  run: WorkflowRun,
  fanOut: Extract<WorkflowNode, { kind: "fan-out" }>,
): number {
  const collected = outputAsList(run.instances[instanceKeyFor(fanOut.id, run.iteration)]?.output);
  if (collected) return collected.length;
  const last = fanOut.lane.toReversed().find((node) => node.kind !== "prompt-block");
  if (!last) return 0;
  const byIndex = new Set<number>();
  for (const instance of Object.values(run.instances)) {
    if (instance.iteration !== run.iteration || instance.index === undefined) continue;
    const owner = fanOut.lane.some((node) => node.id === instance.nodeId);
    if (!owner) continue;
    if (
      instance.status === "failed" ||
      (instance.nodeId === last.id && instance.status === "done")
    ) {
      byIndex.add(instance.index);
    }
  }
  return byIndex.size;
}

function Elapsed(props: { startedAt: string; finishedAt: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const live = props.finishedAt === null;
  useEffect(() => {
    if (!live) return;
    const update = () => {
      if (ref.current) ref.current.textContent = formatElapsedDurationLabel(props.startedAt);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [live, props.startedAt]);
  return (
    <span ref={ref} className="tabular-nums">
      {formatElapsedDurationLabel(
        props.startedAt,
        props.finishedAt ? Date.parse(props.finishedAt) : Date.now(),
      )}
    </span>
  );
}

/**
 * A run rendered on the same canvas as the builder, read-only: bubble borders follow instance
 * status, lanes show progress, and the selected bubble's detail lists outputs, errors and the
 * threads it ran on. Stop / Approve / Reject live in the header.
 */
export function WorkflowRunPanel(props: {
  run: WorkflowRun;
  maximized: boolean;
  onSetMaximized?: ((maximized: boolean) => void) | undefined;
  onBack: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onApprove: () => void;
  onReject: () => void;
  onOpenThread: (thread: WorkflowInstanceThread) => void;
}) {
  const { run } = props;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = selectedNodeId ? findNode(run.snapshot.nodes, selectedNodeId) : null;
  const selectedInstances = useMemo(
    () => (selectedNodeId ? instancesFor(run, selectedNodeId) : []),
    [run, selectedNodeId],
  );
  const active = run.status === "in-progress" || run.status === "review";
  const statusColor =
    run.status === "failed" || run.status === "stuck" || run.status === "cancelled"
      ? "text-destructive"
      : run.status === "done"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: run.color, boxShadow: `0 0 8px -1px ${run.color}` }}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{run.name}</span>
        <span className={cn("shrink-0 text-xs", statusColor)}>
          {run.status === "in-progress" && run.pausedAt !== null
            ? "Paused"
            : RUN_STATUS_LABELS[run.status]}
        </span>
        {run.iteration > 0 || run.nextIterationAt ? (
          <span className="shrink-0 text-xs text-muted-foreground">⟲ {run.iteration + 1}</span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">
          <Elapsed startedAt={run.startedAt} finishedAt={run.finishedAt} />
        </span>
        {props.onSetMaximized ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={props.maximized ? "Restore panel" : "Maximize panel"}
                  onClick={() => props.onSetMaximized?.(!props.maximized)}
                />
              }
            >
              {props.maximized ? <Minimize2Icon /> : <Maximize2Icon />}
            </TooltipTrigger>
            <TooltipPopup>{props.maximized ? "Restore panel" : "Maximize panel"}</TooltipPopup>
          </Tooltip>
        ) : null}
        {run.status === "review" ? (
          <>
            <Button type="button" size="xs" onClick={props.onApprove}>
              Approve
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={props.onReject}>
              Reject
            </Button>
          </>
        ) : null}
        {run.status === "in-progress" ? (
          run.pausedAt !== null ? (
            <Button type="button" size="xs" onClick={props.onResume}>
              <PlayIcon className="size-3" />
              Resume
            </Button>
          ) : (
            <Button type="button" size="xs" variant="outline" onClick={props.onPause}>
              <PauseIcon className="size-3" />
              Pause
            </Button>
          )
        ) : null}
        {active ? (
          <Button type="button" size="xs" variant="outline" onClick={props.onStop}>
            <SquareIcon className="size-3" />
            Stop
          </Button>
        ) : null}
      </WorkflowsSubheader>
      <div className={cn("flex min-h-0 flex-1", props.maximized ? "flex-row" : "flex-col")}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {run.status === "review" && run.review ? (
            <div
              className="mx-3 mt-3 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: WORKFLOW_NODE_META.review.accent }}
            >
              <div className="mb-0.5 font-medium">Waiting for your review</div>
              <div className="whitespace-pre-wrap text-muted-foreground">{run.review.summary}</div>
            </div>
          ) : null}
          {run.lastError && run.status !== "in-progress" && run.status !== "review" ? (
            <div className="mx-3 mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {stuckReason(run)}
            </div>
          ) : null}
          <WorkflowCanvas
            nodes={run.snapshot.nodes}
            selectedNodeId={selectedNodeId}
            onSelect={(nodeId) =>
              setSelectedNodeId((current) => (current === nodeId ? null : nodeId))
            }
            runStateFor={(nodeId) => runStateFor(run, nodeId)}
          />
          {run.result ? (
            <div
              className="mx-3 mb-4 rounded-2xl border px-3 py-2"
              style={{ borderColor: run.color }}
            >
              <div className="mb-1 text-xs font-medium" style={{ color: run.color }}>
                Result
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">
                {run.result}
              </pre>
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            "min-h-0 shrink-0 overflow-y-auto border-border/60 bg-background",
            props.maximized ? "w-[360px] border-l" : "max-h-[46%] border-t",
            !selectedNode && "hidden",
          )}
        >
          {selectedNode ? (
            <InstanceDetail
              node={selectedNode}
              instances={selectedInstances}
              onOpenThread={props.onOpenThread}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const INSTANCE_LABELS: Record<WorkflowNodeInstance["status"], string> = {
  pending: "Queued",
  running: "Running",
  "waiting-review": "Waiting for review",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

function InstanceDetail(props: {
  node: WorkflowNode;
  instances: readonly WorkflowNodeInstance[];
  onOpenThread: (thread: WorkflowInstanceThread) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-sm font-medium">{workflowNodeTitle(props.node)}</div>
      {props.instances.length === 0 ? (
        <div className="text-xs text-muted-foreground">Not reached yet.</div>
      ) : (
        props.instances.map((instance) => (
          <div
            key={instance.key}
            className="rounded-lg border border-border/60 px-2.5 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {instance.index !== undefined ? `Lane ${instance.index + 1} · ` : ""}
                {INSTANCE_LABELS[instance.status]}
              </span>
              {instance.files?.length ? (
                <span className="text-muted-foreground">
                  {instance.files.length} file{instance.files.length === 1 ? "" : "s"}
                </span>
              ) : null}
              <span className="flex-1" />
              {instance.thread ? (
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="xs"
                  className="h-6 px-1.5"
                  onClick={() => props.onOpenThread(instance.thread!)}
                >
                  Open thread
                  <ExternalLinkIcon className="size-3" />
                </Button>
              ) : null}
            </div>
            {instance.error ? <div className="mt-1 text-destructive">{instance.error}</div> : null}
            {instance.output ? (
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[.7rem] text-muted-foreground">
                {truncate(outputAsText(instance.output), 1_200)}
              </pre>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
