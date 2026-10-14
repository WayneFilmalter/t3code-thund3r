/**
 * The map borrows the workflow builder's neon accents so both panels read as one family.
 * Keyed by what a bubble or satellite represents, not by node kind.
 */
import { FAILED_ACCENT } from "~/components/workflows/builder/NodeBubble";
import { WORKFLOW_NODE_META } from "~/workflows/workflowNodeMeta";

export type AgentMapCategory = "read" | "search" | "edit" | "shell" | "web" | "plan" | "other";

export const AGENT_MAP_ACCENTS = {
  main: WORKFLOW_NODE_META["linear-agent"].accent,
  subagent: WORKFLOW_NODE_META.review.accent,
  failed: FAILED_ACCENT,
  stalled: "oklch(0.6 0.01 260)",
  context: WORKFLOW_NODE_META.gate.accent,
} as const;

export const AGENT_MAP_CATEGORY_ACCENTS: Record<AgentMapCategory, string> = {
  read: WORKFLOW_NODE_META.agent.accent,
  search: WORKFLOW_NODE_META.agent.accent,
  edit: WORKFLOW_NODE_META["fan-out"].accent,
  shell: WORKFLOW_NODE_META.start.accent,
  web: WORKFLOW_NODE_META.gate.accent,
  plan: WORKFLOW_NODE_META.gate.accent,
  other: WORKFLOW_NODE_META["prompt-block"].accent,
};

export const AGENT_MAP_LEGEND: ReadonlyArray<{ label: string; accent: string }> = [
  { label: "Agent", accent: AGENT_MAP_ACCENTS.main },
  { label: "Subagent", accent: AGENT_MAP_ACCENTS.subagent },
  { label: "Read or search", accent: AGENT_MAP_CATEGORY_ACCENTS.read },
  { label: "Edit", accent: AGENT_MAP_CATEGORY_ACCENTS.edit },
  { label: "Shell", accent: AGENT_MAP_CATEGORY_ACCENTS.shell },
  { label: "Web", accent: AGENT_MAP_CATEGORY_ACCENTS.web },
  { label: "Context used", accent: AGENT_MAP_ACCENTS.context },
];
