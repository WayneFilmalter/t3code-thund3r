/**
 * The map borrows the workflow builder's neon accents so both panels read as one family.
 * Keyed by what a bubble or satellite represents, not by node kind.
 */
import {
  CircleHelpIcon,
  CogIcon,
  GlobeIcon,
  type LucideIcon,
  PenLineIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";

import { FAILED_ACCENT } from "~/components/workflows/builder/NodeBubble";
import { WORKFLOW_NODE_META } from "~/workflows/workflowNodeMeta";

export type AgentMapCategory =
  | "read"
  | "search"
  | "edit"
  | "shell"
  | "web"
  | "plan"
  | "question"
  | "other";

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
  // No workflow node is blue, and every other accent is already a cell or task colour.
  question: "oklch(0.74 0.17 255)",
  other: WORKFLOW_NODE_META["prompt-block"].accent,
};

/** What a task bubble or chip shows instead of a word. */
export const AGENT_MAP_CATEGORY_ICONS: Record<AgentMapCategory, LucideIcon> = {
  read: SearchIcon,
  search: SearchIcon,
  edit: CogIcon,
  shell: SquareTerminalIcon,
  web: GlobeIcon,
  plan: PenLineIcon,
  question: CircleHelpIcon,
  other: WrenchIcon,
};

/** Names for the tooltip, feed chip title and legend; read and search share one. */
export const AGENT_MAP_CATEGORY_LABELS: Record<AgentMapCategory, string> = {
  read: "Research",
  search: "Research",
  edit: "Edit",
  shell: "Shell",
  web: "Web",
  plan: "Plan",
  question: "Question",
  other: "Tool",
};

export const AGENT_MAP_LEGEND: ReadonlyArray<{
  label: string;
  accent: string;
  icon?: LucideIcon;
  line?: boolean;
}> = [
  { label: "Agent", accent: AGENT_MAP_ACCENTS.main },
  { label: "Subagent", accent: AGENT_MAP_ACCENTS.subagent },
  ...(["read", "edit", "shell", "web", "plan", "question", "other"] as const).map((category) => ({
    label: AGENT_MAP_CATEGORY_LABELS[category],
    accent: AGENT_MAP_CATEGORY_ACCENTS[category],
    icon: AGENT_MAP_CATEGORY_ICONS[category],
  })),
  { label: "Context used", accent: AGENT_MAP_ACCENTS.context, line: true },
];
