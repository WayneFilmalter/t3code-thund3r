/**
 * The readable side of the map, laid out like the app's subagent list: a title, a
 * preview of the latest progress or result, and a metadata line (model, effort,
 * tokens, tools), with elapsed time on the right. On top of that each row carries
 * the agent's map name and colour, and its finished work as coloured task chips.
 */
import { formatModelSlugName } from "@t3tools/shared/model";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { CheckIcon, XIcon } from "lucide-react";

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

const WORKING = new Set<AgentBubbleStatus>(["tool", "thinking", "waiting", "stalled"]);

function rowAccent(bubble: AgentBubble): string {
  if (bubble.status === "failed") return AGENT_MAP_ACCENTS.failed;
  if (bubble.status === "stalled") return AGENT_MAP_ACCENTS.stalled;
  return bubble.kind === "main" ? AGENT_MAP_ACCENTS.main : AGENT_MAP_ACCENTS.subagent;
}

function metadataLine(bubble: AgentBubble): string {
  return [
    bubble.model ? formatModelSlugName(bubble.model) : null,
    bubble.effort,
    bubble.tokens === null ? null : `${formatContextWindowTokens(bubble.tokens)} tok`,
    bubble.toolCount === null
      ? null
      : `${bubble.toolCount} ${bubble.toolCount === 1 ? "tool" : "tools"}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Live rows lead with what is happening now; settled rows with their outcome. */
function previewLine(bubble: AgentBubble): string {
  if (WORKING.has(bubble.status) && bubble.subtitle) return `▸ ${bubble.subtitle}`;
  return bubble.preview ?? AGENT_STATUS_LABELS[bubble.status];
}

export function AgentActivityFeed(props: { readonly model: AgentMapModel }) {
  const [main, ...subagents] = orderAgentFeed(props.model);
  const working = subagents.filter((bubble) => WORKING.has(bubble.status)).length;
  const settled = subagents.filter(
    (bubble) => bubble.status === "done" || bubble.status === "failed",
  ).length;
  const totalTokens = [main, ...subagents].reduce(
    (total, bubble) => total + (bubble?.tokens ?? 0),
    0,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {main ? (
          <section>
            <SectionHeading>Main agent</SectionHeading>
            <FeedRow bubble={main} />
          </section>
        ) : null}
        {subagents.length > 0 ? (
          <section className="mt-1.5">
            <SectionHeading>Subagents</SectionHeading>
            {subagents.map((bubble) => (
              <FeedRow key={bubble.id} bubble={bubble} />
            ))}
          </section>
        ) : null}
      </div>
      <footer className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 font-mono text-2xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {working > 0 ? (
            <span className="text-foreground">
              <span style={{ color: AGENT_MAP_ACCENTS.subagent }}>●</span> {working} working
            </span>
          ) : null}
          {settled > 0 ? <span>{settled} settled</span> : null}
        </span>
        <span className="tabular-nums">Σ {formatContextWindowTokens(totalTokens)} tok</span>
      </footer>
    </div>
  );
}

function SectionHeading(props: { readonly children: string }) {
  return (
    <div className="px-1.5 pt-1 pb-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
      {props.children}
    </div>
  );
}

function FeedRow(props: { readonly bubble: AgentBubble }) {
  const { bubble } = props;
  const accent = rowAccent(bubble);
  const working = WORKING.has(bubble.status);
  const title = bubble.detail ?? bubble.name;
  const metadata = metadataLine(bubble);
  return (
    <div className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1.5">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: accent, boxShadow: working ? `0 0 6px ${accent}` : undefined }}
      />
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span
          className="shrink-0 rounded-sm border px-1 font-mono text-3xs font-semibold text-foreground"
          style={{
            borderColor: `color-mix(in oklch, ${accent} 60%, transparent)`,
            background: `color-mix(in oklch, ${accent} 18%, transparent)`,
          }}
        >
          {bubble.name}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums text-muted-foreground">
        {bubble.elapsedMs === null ? null : formatDuration(bubble.elapsedMs)}
        {bubble.status === "done" ? (
          <CheckIcon aria-hidden className="size-3 text-success" />
        ) : null}
        {bubble.status === "failed" ? (
          <XIcon aria-hidden className="size-3 text-destructive-foreground" />
        ) : null}
      </span>
      <span
        className={cn(
          "col-start-2 col-end-4 truncate text-xs",
          bubble.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      >
        {previewLine(bubble)}
      </span>
      {metadata ? (
        <span className="col-start-2 col-end-4 truncate font-mono text-2xs tabular-nums text-muted-foreground/75">
          {metadata}
        </span>
      ) : null}
      {bubble.tasks.length > 0 ? (
        <span className="col-start-2 col-end-4 flex flex-wrap gap-1 pt-0.5">
          {bubble.tasks.map((task) => (
            <span
              key={task.id}
              className="rounded-full border px-1.5 text-3xs leading-4 text-foreground"
              style={{
                borderColor: `color-mix(in oklch, ${AGENT_MAP_CATEGORY_ACCENTS[task.category]} 60%, transparent)`,
                background: `color-mix(in oklch, ${AGENT_MAP_CATEGORY_ACCENTS[task.category]} 16%, transparent)`,
              }}
            >
              {task.label}
            </span>
          ))}
        </span>
      ) : null}
      <span className="sr-only">{AGENT_STATUS_LABELS[bubble.status]}</span>
    </div>
  );
}
