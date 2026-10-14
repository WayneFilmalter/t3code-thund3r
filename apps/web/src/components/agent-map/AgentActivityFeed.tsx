/**
 * The readable side of the map: one row per agent with its name, model, status, what it
 * is doing, its tokens and time, and the work it has finished as coloured chips.
 */
import { formatDuration } from "@t3tools/shared/orchestrationTiming";

import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";

import {
  AGENT_STATUS_LABELS,
  orderAgentFeed,
  type AgentBubble,
  type AgentBubbleStatus,
  type AgentMapModel,
} from "./agentMap.logic";
import { AGENT_MAP_ACCENTS, AGENT_MAP_CATEGORY_ACCENTS } from "./agentMapColors";

const ACTIVE = new Set<AgentBubbleStatus>(["tool", "thinking", "waiting"]);

function rowAccent(bubble: AgentBubble): string {
  if (bubble.status === "failed") return AGENT_MAP_ACCENTS.failed;
  if (bubble.status === "stalled") return AGENT_MAP_ACCENTS.stalled;
  return bubble.kind === "main" ? AGENT_MAP_ACCENTS.main : AGENT_MAP_ACCENTS.subagent;
}

export function AgentActivityFeed(props: { readonly model: AgentMapModel }) {
  const rows = orderAgentFeed(props.model);
  const working = rows.filter((bubble) => ACTIVE.has(bubble.status)).length;
  const done = rows.filter((bubble) => bubble.status === "done").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-semibold text-foreground">Activity</span>
        <span className="text-2xs tabular-nums text-muted-foreground">
          {rows.length} {rows.length === 1 ? "agent" : "agents"} · {working} working · {done} done
        </span>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {rows.map((bubble) => (
          <FeedRow key={bubble.id} bubble={bubble} />
        ))}
      </ul>
    </div>
  );
}

function FeedRow(props: { readonly bubble: AgentBubble }) {
  const { bubble } = props;
  const accent = rowAccent(bubble);
  const active = ACTIVE.has(bubble.status);
  const tokens =
    bubble.tokens === null ? null : `${formatContextWindowTokens(bubble.tokens)} tokens`;
  const elapsed = bubble.elapsedMs === null ? null : formatDuration(bubble.elapsedMs);
  const doing = active || bubble.status === "stalled" ? bubble.subtitle : null;
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: active ? `0 0 6px ${accent}` : undefined }}
        />
        <span className="truncate text-sm font-semibold text-foreground">{bubble.name}</span>
        {bubble.kind === "main" ? (
          <span className="shrink-0 text-2xs text-muted-foreground">main</span>
        ) : null}
        {bubble.model ? (
          <span className="min-w-0 truncate rounded bg-muted px-1.5 py-px font-mono text-2xs text-muted-foreground">
            {bubble.model}
          </span>
        ) : null}
        <span
          className={cn(
            "ml-auto shrink-0 rounded-full border px-2 py-px text-2xs font-medium",
            active ? "text-foreground" : "text-muted-foreground",
          )}
          style={{
            borderColor: `color-mix(in oklch, ${accent} 55%, transparent)`,
            background: `color-mix(in oklch, ${accent} ${active ? 22 : 10}%, transparent)`,
          }}
        >
          {AGENT_STATUS_LABELS[bubble.status]}
        </span>
      </div>
      {bubble.detail ? (
        <p className="line-clamp-2 pl-4.5 text-xs text-foreground/85">{bubble.detail}</p>
      ) : null}
      {doing && doing !== bubble.detail ? (
        <p className="truncate pl-4.5 text-xs text-muted-foreground">
          <span className="text-foreground/70">Now: </span>
          {doing}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1 pl-4.5">
        {bubble.tasks.map((task) => (
          <span
            key={task.id}
            className="rounded-full border px-1.5 py-px text-2xs text-foreground"
            style={{
              borderColor: `color-mix(in oklch, ${AGENT_MAP_CATEGORY_ACCENTS[task.category]} 60%, transparent)`,
              background: `color-mix(in oklch, ${AGENT_MAP_CATEGORY_ACCENTS[task.category]} 16%, transparent)`,
            }}
          >
            {task.label}
          </span>
        ))}
        {tokens || elapsed ? (
          <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
            {[tokens, elapsed].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>
    </li>
  );
}
