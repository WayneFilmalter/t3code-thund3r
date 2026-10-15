/**
 * Neon accents for the Agents map. Each agent bubble takes its own base colour from a
 * hashed palette; status lives in a separate dot colour so a bubble stays recognisable
 * while its state changes. Task cells are keyed by what they represent.
 */
import {
  CircleHelpIcon,
  CogIcon,
  GlobeIcon,
  PenLineIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { GitHubIcon } from "~/components/Icons";
import { fnv1a32 } from "~/lib/hash";
import { WORKFLOW_NODE_META } from "~/workflows/workflowNodeMeta";

import type { AgentBubble, AgentBubbleStatus } from "./agentMap.logic";

export type AgentMapCategory =
  | "read"
  | "search"
  | "edit"
  | "shell"
  | "web"
  | "plan"
  | "question"
  | "pr"
  | "other";

export type AgentMapIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Vivid colours for agent bodies, in a bright and a deep tier so more agents stay apart.
 * Task cells own orange, gold, lime, pale cyan and blue, and a failed body is red, so
 * agents take the rest of the wheel: mint and teal, petrol, violet through pink.
 */
export const AGENT_BASE_PALETTE: ReadonlyArray<string> = [
  "oklch(0.84 0.19 162)",
  "oklch(0.78 0.16 290)",
  "oklch(0.68 0.27 325)",
  "oklch(0.64 0.16 178)",
  "oklch(0.8 0.2 345)",
  "oklch(0.64 0.24 280)",
  "oklch(0.64 0.14 215)",
  "oklch(0.7 0.25 305)",
];

/** The main agent's colour, hashed from its thread so it survives reloads. */
export function rootAccent(threadId: string): string {
  return AGENT_BASE_PALETTE[fnv1a32(`${threadId}:hue`) % AGENT_BASE_PALETTE.length]!;
}

/**
 * A subagent's colour by its place in spawn order: never the root's, and siblings differ
 * until the palette wraps. The start point is hashed so threads do not all open alike.
 */
export function childAccent(threadId: string, index: number): string {
  const root = rootAccent(threadId);
  const others = AGENT_BASE_PALETTE.filter((accent) => accent !== root);
  return others[(fnv1a32(`${threadId}:children`) + index) % others.length]!;
}

export const AGENT_MAP_ACCENTS = {
  /** A failed body goes deep crimson; the status dot's red is brighter so both read apart. */
  failed: "oklch(0.58 0.22 15)",
  stalled: "oklch(0.6 0.01 260)",
  context: WORKFLOW_NODE_META.gate.accent,
} as const;

/** The colour of the status dot inside a bubble and beside its feed row. */
export const AGENT_STATUS_ACCENTS: Record<AgentBubbleStatus, string> = {
  done: "oklch(0.85 0.23 145)",
  tool: "oklch(0.75 0.19 250)",
  thinking: "oklch(0.75 0.19 250)",
  waiting: "oklch(0.9 0.19 95)",
  failed: "oklch(0.72 0.26 25)",
  idle: "oklch(0.7 0.02 260)",
  stalled: "oklch(0.7 0.02 260)",
};

/** The body colour of an agent bubble: its own hue unless it has failed or stalled. */
export function bubbleAccent(bubble: Pick<AgentBubble, "accent" | "status">): string {
  if (bubble.status === "failed") return AGENT_MAP_ACCENTS.failed;
  if (bubble.status === "stalled") return AGENT_MAP_ACCENTS.stalled;
  return bubble.accent;
}

export const AGENT_MAP_CATEGORY_ACCENTS: Record<AgentMapCategory, string> = {
  read: WORKFLOW_NODE_META.agent.accent,
  search: WORKFLOW_NODE_META.agent.accent,
  edit: WORKFLOW_NODE_META["fan-out"].accent,
  shell: WORKFLOW_NODE_META.start.accent,
  web: WORKFLOW_NODE_META.gate.accent,
  plan: WORKFLOW_NODE_META.gate.accent,
  // No workflow node is blue, and every other accent is already a cell or task colour.
  question: "oklch(0.74 0.17 255)",
  // Near-white lilac: nothing else on the map is pale, so a pull request stands out.
  pr: "oklch(0.9 0.04 300)",
  other: WORKFLOW_NODE_META["prompt-block"].accent,
};

/** What a task bubble or chip shows instead of a word. */
export const AGENT_MAP_CATEGORY_ICONS: Record<AgentMapCategory, AgentMapIcon> = {
  read: SearchIcon,
  search: SearchIcon,
  edit: CogIcon,
  shell: SquareTerminalIcon,
  web: GlobeIcon,
  plan: PenLineIcon,
  question: CircleHelpIcon,
  pr: GitHubIcon,
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
  pr: "Pull request",
  other: "Tool",
};

export const AGENT_MAP_LEGEND: ReadonlyArray<{
  label: string;
  accent: string;
  icon?: AgentMapIcon;
  line?: boolean;
}> = [
  { label: "Done", accent: AGENT_STATUS_ACCENTS.done },
  { label: "Busy", accent: AGENT_STATUS_ACCENTS.tool },
  { label: "Needs you", accent: AGENT_STATUS_ACCENTS.waiting },
  { label: "Failed", accent: AGENT_STATUS_ACCENTS.failed },
  { label: "Idle", accent: AGENT_STATUS_ACCENTS.idle },
  ...(["read", "edit", "shell", "web", "plan", "question", "pr", "other"] as const).map(
    (category) => ({
      label: AGENT_MAP_CATEGORY_LABELS[category],
      accent: AGENT_MAP_CATEGORY_ACCENTS[category],
      icon: AGENT_MAP_CATEGORY_ICONS[category],
    }),
  ),
  { label: "Context used", accent: AGENT_MAP_ACCENTS.context, line: true },
];
