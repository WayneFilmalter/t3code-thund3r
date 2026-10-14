/**
 * One agent on the map: halo, body, optional context ring, orbiting tool satellites
 * and docked task bubbles. Purely presentational; every number comes from the layout.
 */
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import type { CSSProperties } from "react";

import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";

import type { AgentBubbleStatus } from "./agentMap.logic";
import { AGENT_MAP_ACCENTS, AGENT_MAP_CATEGORY_ACCENTS } from "./agentMapColors";
import { hashedAngle, type PlacedBubble } from "./agentMapLayout";

function bodyAccent(status: AgentBubbleStatus, base: string): string {
  if (status === "failed") return AGENT_MAP_ACCENTS.failed;
  if (status === "stalled") return AGENT_MAP_ACCENTS.stalled;
  return base;
}

export function AgentBubbleView(props: {
  readonly placed: PlacedBubble;
  /** Where a spawn or dock animation starts from, usually the parent's centre. */
  readonly origin: { readonly x: number; readonly y: number } | null;
  readonly animated: boolean;
  readonly live: boolean;
}) {
  const { placed } = props;
  const { bubble, x, y, r } = placed;
  const base = bubble.kind === "main" ? AGENT_MAP_ACCENTS.main : AGENT_MAP_ACCENTS.subagent;
  const accent = bodyAccent(bubble.status, base);
  const halo = bubble.status !== "stalled";
  const fill =
    bubble.status === "tool"
      ? accent
      : bubble.status === "done" || bubble.status === "failed"
        ? accent
        : "none";
  const fillOpacity = bubble.status === "tool" ? 0.35 : 0.18;
  const ringRadius = r + 4;
  const ringLength = 2 * Math.PI * ringRadius;
  const ringFilled = bubble.contextFraction === null ? 0 : ringLength * bubble.contextFraction;
  const tokens = bubble.tokens === null ? null : formatContextWindowTokens(bubble.tokens);
  const elapsed = bubble.elapsedMs === null ? null : formatDuration(bubble.elapsedMs);
  const meta = [tokens === null ? null : `${tokens} tok`, elapsed].filter(Boolean).join(" · ");
  const fontScale = Math.max(0.7, Math.min(1, r / 40));
  const driftDelay = `-${(hashedAngle(`${bubble.id}:drift`) / (Math.PI * 2)) * 9}s`;
  const groupStyle: CSSProperties & Record<`--${string}`, string> = {
    "--agent-map-x": `${x}px`,
    "--agent-map-y": `${y}px`,
    "--agent-map-from-x": `${props.origin?.x ?? x}px`,
    "--agent-map-from-y": `${props.origin?.y ?? y}px`,
    animationDelay: driftDelay,
  };
  const drifting = props.animated && props.live && bubble.kind === "subagent" && !placed.docked;

  return (
    <g
      className={cn(
        "agent-map-bubble",
        props.animated &&
          bubble.kind === "subagent" &&
          (placed.docked ? "agent-map-dock" : "agent-map-spawn"),
        drifting && "agent-map-drift",
      )}
      style={groupStyle}
      data-status={bubble.status}
    >
      {halo ? <circle cx={x} cy={y} r={r + 8} fill={accent} opacity={0.16} /> : null}
      {bubble.contextFraction !== null ? (
        <>
          <circle
            cx={x}
            cy={y}
            r={ringRadius}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={3}
          />
          <circle
            className="agent-map-ring"
            cx={x}
            cy={y}
            r={ringRadius}
            fill="none"
            stroke={AGENT_MAP_ACCENTS.context}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${ringFilled} ${ringLength}`}
            transform={`rotate(-90 ${x} ${y})`}
          />
          {bubble.compacted ? (
            <text
              x={x + r * 0.75}
              y={y - r * 0.75}
              fontSize={12 * fontScale}
              fill={AGENT_MAP_ACCENTS.context}
              textAnchor="middle"
            >
              ↻
            </text>
          ) : null}
        </>
      ) : null}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={accent}
        strokeWidth={bubble.status === "failed" ? 2 : 1.25}
        strokeDasharray={bubble.status === "waiting" ? "4 3" : undefined}
        opacity={bubble.status === "waiting" ? 0.6 : 1}
      />
      <text
        x={x}
        y={y - (bubble.subtitle ? 3 : 0) * fontScale}
        textAnchor="middle"
        fontSize={13 * fontScale}
        fontWeight={600}
        fill="currentColor"
      >
        {bubble.name}
      </text>
      {bubble.subtitle ? (
        <text
          x={x}
          y={y + 10 * fontScale}
          textAnchor="middle"
          fontSize={9.5 * fontScale}
          fill="currentColor"
          opacity={0.7}
        >
          {bubble.subtitle}
        </text>
      ) : null}
      {meta ? (
        <text
          x={x}
          y={y + r + 14}
          textAnchor="middle"
          fontSize={9.5}
          fill="currentColor"
          opacity={0.6}
        >
          {meta}
        </text>
      ) : null}
      {placed.satellites.map((satellite, index) => {
        const model = bubble.satellites[index]!;
        const satelliteAccent =
          model.status === "failed"
            ? AGENT_MAP_ACCENTS.failed
            : AGENT_MAP_CATEGORY_ACCENTS[model.category];
        return (
          <circle
            key={satellite.id}
            cx={satellite.x}
            cy={satellite.y}
            r={3}
            fill={satelliteAccent}
            opacity={model.opacity}
            stroke={model.status === "failed" ? AGENT_MAP_ACCENTS.failed : "none"}
            strokeWidth={model.status === "failed" ? 1.5 : 0}
          />
        );
      })}
      {placed.tasks.map((task, index) => {
        const model = bubble.tasks[index]!;
        const taskAccent = AGENT_MAP_CATEGORY_ACCENTS[model.category];
        return (
          <g key={task.id}>
            <circle
              cx={task.x}
              cy={task.y}
              r={task.r}
              fill={taskAccent}
              fillOpacity={0.3}
              stroke={taskAccent}
              strokeWidth={1}
            >
              <title>
                {model.label}
                {model.durationMs > 0 ? ` · ${formatDuration(model.durationMs)}` : ""}
              </title>
            </circle>
            <text
              x={task.x}
              y={task.y + task.r + 9}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.65}
            >
              {model.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
