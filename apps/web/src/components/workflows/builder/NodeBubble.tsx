import { CheckIcon, XIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { WORKFLOW_NODE_META, workflowNodeTitle } from "~/workflows/workflowNodeMeta";
import type { WorkflowInstanceStatus, WorkflowNode } from "~/workflowsStore";

import { NODE_ICONS, PLAN_ICON } from "./nodeIcons";

export const FAILED_ACCENT = "oklch(0.7 0.2 25)";
const REVIEW_ACCENT = WORKFLOW_NODE_META.review.accent;

export interface NodeBubbleRunState {
  status: WorkflowInstanceStatus | "idle";
  /** Fan-out lanes: `done/total`. */
  laneProgress?: { done: number; total: number } | undefined;
}

/** Text chips summarising a node's config at a glance. */
export function nodeChips(node: WorkflowNode): string[] {
  switch (node.kind) {
    case "start":
      return node.mode === "loop" ? [`⟲ loop ×${node.maxIterations}`] : ["once"];
    case "agent":
    case "linear-agent": {
      const chips: string[] = [];
      if (node.kind === "agent" && node.interactionMode === "plan") chips.push("plan mode");
      if (node.kind === "linear-agent") chips.push(node.preset);
      chips.push(node.modelSelection ? shortModel(node.modelSelection.model) : "inherits model");
      chips.push(node.session === "continue" ? "↳ same agent" : "✦ new agent");
      if (node.envMode === "worktree") chips.push("worktree");
      if (node.output.kind !== "none") chips.push(`→ ${node.output.kind}`);
      if (node.skills.length)
        chips.push(
          `/${node.skills.length === 1 ? node.skills[0] : `${node.skills.length} skills`}`,
        );
      return chips;
    }
    case "fan-out":
      return [
        `× ${node.maxParallel} parallel`,
        ...(node.laneEnvMode === "worktree" ? ["worktree per lane"] : []),
      ];
    case "gate":
      return [
        node.onFail.kind === "retry"
          ? `retry ×${node.onFail.times}`
          : node.onFail.kind === "continue"
            ? "continue on fail"
            : "stop on fail",
      ];
    case "review":
      return ["approve / reject"];
    case "action":
      return [node.session === "continue" ? "↳ same agent" : "✦ new agent"];
    case "prompt-block":
      return [node.placement === "before" ? "before prompt" : "after prompt"];
    case "end":
      return node.reportPrompt.trim() ? ["report"] : ["last output"];
  }
}

function shortModel(model: string): string {
  return model.length > 22 ? `${model.slice(0, 21)}…` : model;
}

/**
 * One node on the canvas: rounded bubble with a neon border in the node kind's accent, icon,
 * title and config chips. Selected and running bubbles glow; idle ones only carry the border.
 * The glow is a static box-shadow — never animated.
 */
export function NodeBubble(props: {
  node: WorkflowNode;
  selected: boolean;
  issues?: readonly string[] | undefined;
  runState?: NodeBubbleRunState | undefined;
  onSelect?: (() => void) | undefined;
  className?: string;
}) {
  const meta = WORKFLOW_NODE_META[props.node.kind];
  const Icon =
    props.node.kind === "agent" && props.node.interactionMode === "plan"
      ? PLAN_ICON
      : NODE_ICONS[props.node.kind];
  const status = props.runState?.status ?? "idle";
  const hasIssue = (props.issues?.length ?? 0) > 0;
  const accent =
    hasIssue || status === "failed"
      ? FAILED_ACCENT
      : status === "waiting-review"
        ? REVIEW_ACCENT
        : meta.accent;
  const glow = props.selected || status === "running" || status === "waiting-review" || hasIssue;
  const dim = status === "pending" || status === "skipped";
  const chips = nodeChips(props.node);
  const style: CSSProperties = {
    borderColor: accent,
    boxShadow: glow ? `0 0 0 1px ${accent}, 0 0 22px -6px ${accent}` : undefined,
  };
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-pressed={props.selected}
      aria-label={`${meta.label}: ${workflowNodeTitle(props.node)}`}
      className={cn(
        "group flex w-full flex-col gap-1 rounded-2xl border bg-card/70 px-3 py-2 text-left transition-[box-shadow,opacity] focus-visible:outline-none",
        dim && "opacity-55",
        props.onSelect ? "cursor-pointer" : "cursor-default",
        props.className,
      )}
      style={style}
    >
      <span className="flex items-center gap-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-lg border"
          style={{ borderColor: accent, color: accent }}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {workflowNodeTitle(props.node)}
        </span>
        <RunBadge status={status} laneProgress={props.runState?.laneProgress} accent={accent} />
      </span>
      {chips.length > 0 || hasIssue ? (
        <span className="flex flex-wrap items-center gap-1 pl-8">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-md border border-border/60 bg-background/60 px-1.5 py-px text-[.68rem] leading-4 text-muted-foreground"
            >
              {chip}
            </span>
          ))}
          {hasIssue ? (
            <span className="text-[.68rem] leading-4" style={{ color: FAILED_ACCENT }}>
              {props.issues![0]}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function RunBadge(props: {
  status: NodeBubbleRunState["status"];
  laneProgress: NodeBubbleRunState["laneProgress"];
  accent: string;
}) {
  if (props.laneProgress) {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {props.laneProgress.done}/{props.laneProgress.total}
      </span>
    );
  }
  switch (props.status) {
    case "running":
      return <Spinner className="size-3.5" style={{ color: props.accent }} />;
    case "done":
      return <CheckIcon className="size-3.5" style={{ color: props.accent }} />;
    case "failed":
      return <XIcon className="size-3.5" style={{ color: props.accent }} />;
    case "waiting-review":
      return (
        <span className="text-[.68rem] uppercase tracking-wide" style={{ color: props.accent }}>
          review
        </span>
      );
    default:
      return null;
  }
}
