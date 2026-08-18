import {
  Bot,
  Flag,
  GitFork,
  GitPullRequest,
  MessageSquareText,
  Play,
  ShieldCheck,
  Ticket,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

import type { WorkflowNodeKind } from "~/workflowsStore";

export const NODE_ICONS: Record<WorkflowNodeKind, LucideIcon> = {
  start: Play,
  agent: Bot,
  "linear-agent": Ticket,
  "fan-out": GitFork,
  gate: ShieldCheck,
  review: UserCheck,
  action: GitPullRequest,
  "prompt-block": MessageSquareText,
  end: Flag,
};
