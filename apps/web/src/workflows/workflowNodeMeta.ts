/**
 * Presentation facts about node kinds shared by the builder canvas, the inspector, and the
 * run view: label, palette category, and the neon accent each bubble is drawn in.
 */
import type { WorkflowNode, WorkflowNodeKind } from "~/workflowsStore";

export type WorkflowNodeCategory = "agents" | "flow" | "actions" | "context";

export interface WorkflowNodeMeta {
  label: string;
  /** One line used in the node palette. */
  blurb: string;
  category: WorkflowNodeCategory;
  /** oklch accent for border, glow and dot; readable on light and dark backgrounds. */
  accent: string;
  /** Kinds users can add from the palette; start/end are fixed frame nodes. */
  insertable: boolean;
}

export const WORKFLOW_NODE_META: Record<WorkflowNodeKind, WorkflowNodeMeta> = {
  start: {
    label: "Start",
    blurb: "Run once or loop until done",
    category: "flow",
    accent: "oklch(0.86 0.24 130)",
    insertable: false,
  },
  agent: {
    label: "Agent",
    blurb: "An agent turn with your prompt",
    category: "agents",
    accent: "oklch(0.85 0.15 200)",
    insertable: true,
  },
  "linear-agent": {
    label: "Linear",
    blurb: "Find, label or comment on tickets",
    category: "agents",
    accent: "oklch(0.72 0.19 295)",
    insertable: true,
  },
  "fan-out": {
    label: "For each",
    blurb: "Run a lane per item, in parallel",
    category: "flow",
    accent: "oklch(0.78 0.18 55)",
    insertable: true,
  },
  gate: {
    label: "Check",
    blurb: "Pass or fail the previous output",
    category: "flow",
    accent: "oklch(0.88 0.19 95)",
    insertable: true,
  },
  review: {
    label: "Human review",
    blurb: "Pause until you approve",
    category: "flow",
    accent: "oklch(0.75 0.2 350)",
    insertable: true,
  },
  action: {
    label: "Action",
    blurb: "Commit, open a PR, comment on a ticket",
    category: "actions",
    accent: "oklch(0.8 0.2 150)",
    insertable: true,
  },
  "prompt-block": {
    label: "Context",
    blurb: "Text injected into the next agent's prompt",
    category: "context",
    accent: "oklch(0.8 0.02 260)",
    insertable: true,
  },
  end: {
    label: "Report",
    blurb: "What the final feedback should look like",
    category: "flow",
    accent: "oklch(0.86 0.24 130)",
    insertable: false,
  },
};

export const WORKFLOW_NODE_CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  agents: "Agents",
  flow: "Flow",
  actions: "Actions",
  context: "Context",
};

/** Palette order: agents first (the common case), then flow, actions, context. */
export const WORKFLOW_PALETTE_KINDS: readonly WorkflowNodeKind[] = [
  "agent",
  "linear-agent",
  "fan-out",
  "gate",
  "review",
  "action",
  "prompt-block",
];

export const WORKFLOW_ACTION_PRESET_LABELS = {
  "commit-pr": "Commit & open PR",
  commit: "Commit",
  "comment-ticket": "Comment on ticket",
  custom: "Custom action",
} as const;

export const WORKFLOW_LINEAR_PRESET_LABELS = {
  find: "Find tickets",
  update: "Update tickets",
  custom: "Custom",
} as const;

/** True for node kinds that execute as an agent turn on a thread. */
export function isAgentTurnNode(node: WorkflowNode): boolean {
  return (
    node.kind === "agent" ||
    node.kind === "linear-agent" ||
    node.kind === "action" ||
    node.kind === "gate" ||
    node.kind === "end"
  );
}

/** The bubble's title: the node's own title/preset when it has one, else the kind label. */
export function workflowNodeTitle(node: WorkflowNode): string {
  switch (node.kind) {
    case "agent":
    case "linear-agent":
      return node.title.trim() || WORKFLOW_NODE_META[node.kind].label;
    case "action":
      return WORKFLOW_ACTION_PRESET_LABELS[node.preset];
    case "fan-out":
      return "For each item";
    case "gate":
      return node.question.trim() ? "Check" : "Check (empty)";
    default:
      return WORKFLOW_NODE_META[node.kind].label;
  }
}
