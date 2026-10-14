/**
 * One cell of the Agents map, as plain HTML so its motion stays on the compositor.
 *
 * Nesting carries the motion, outermost first:
 * - the cell element, moved by the physics hook (`translate3d`, written outside React);
 * - the float wrapper, a slow ambient drift in CSS that task cells ride along with;
 * - the pulse wrapper, re-keyed to replay one-shot bud and squish animations;
 * - the body, which only paints.
 */
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { fnv1a32 } from "~/lib/hash";
import { cn } from "~/lib/utils";

import type { AgentBubble, AgentBubbleStatus, AgentMapTask } from "./agentMap.logic";
import {
  AGENT_MAP_ACCENTS,
  AGENT_MAP_CATEGORY_ACCENTS,
  type AgentMapCategory,
} from "./agentMapColors";
import { hashedAngle, type PackedCell, type PackedTask } from "./agentMapLayout";

const FLOAT_VARIANTS = [
  "agent-cell-float-a",
  "agent-cell-float-b",
  "agent-cell-float-c",
  "agent-cell-float-d",
] as const;

/** How lit and saturated a body is, by what the cell is doing. Working cells glow hottest. */
const ENERGY: Record<AgentBubbleStatus, number> = {
  tool: 1,
  thinking: 0.92,
  idle: 0.82,
  waiting: 0.62,
  done: 0.86,
  failed: 0.9,
  stalled: 0.45,
};

function cellAccent(bubble: AgentBubble): string {
  if (bubble.status === "failed") return AGENT_MAP_ACCENTS.failed;
  if (bubble.status === "stalled") return AGENT_MAP_ACCENTS.stalled;
  return bubble.kind === "main" ? AGENT_MAP_ACCENTS.main : AGENT_MAP_ACCENTS.subagent;
}

/** The accent with its lightness and chroma scaled, via CSS relative colour syntax. */
function shade(accent: string, lightness: number, chroma: number): string {
  return `oklch(from ${accent} calc(l * ${lightness}) calc(c * ${chroma}) h)`;
}

/**
 * A saturated, opaque body lit from the top left with a soft glow, so cells read as
 * vivid and whatever sits behind one never shows through. `energy` runs 0 to 1.
 */
export function membraneStyle(accent: string, energy: number): CSSProperties {
  const midLightness = (0.6 + 0.24 * energy).toFixed(3);
  const saturation = (0.75 + 0.55 * energy).toFixed(3);
  return {
    background: `radial-gradient(circle at 32% 26%, ${shade(accent, 1.12, Number(saturation))} 0%, ${shade(accent, Number(midLightness), Number(saturation))} 44%, ${shade(accent, 0.5, 1.05)} 100%)`,
    borderColor: shade(accent, 1.1, 1.3),
    borderWidth: 1.5,
    boxShadow: `0 0 18px -5px ${accent}, inset 0 -10px 16px -10px ${shade(accent, 0.3, 1)}`,
  };
}

/**
 * Label ink for a body in this accent. Pale accents (lime, yellow, teal) light up too
 * bright for white text, so they get dark ink; deeper ones get white with a firm shadow.
 */
export function labelInk(accent: string): CSSProperties {
  const lightness = Number(/oklch\(\s*([\d.]+)/.exec(accent)?.[1] ?? 0.7);
  return lightness >= 0.82
    ? { color: "oklch(0.2 0.03 260)", textShadow: "0 1px 1px rgb(255 255 255 / 0.35)" }
    : {
        color: "white",
        textShadow: "0 1px 2px rgb(0 0 0 / 0.75), 0 0 6px rgb(0 0 0 / 0.35)",
      };
}

/** Every body breathes on its own slow clock, so a still cluster never looks frozen. */
function breatheStyle(id: string): CSSProperties {
  const hash = fnv1a32(`${id}:breathe`);
  return {
    animationDuration: `${4 + ((hash >>> 3) % 300) / 100}s`,
    animationDelay: `-${((hash >>> 11) % 700) / 100}s`,
  };
}

/** Each cell drifts on its own path and clock, picked from its id so it is stable. */
function floatStyle(id: string): { className: string; style: CSSProperties } {
  const hash = fnv1a32(`${id}:float`);
  return {
    className: FLOAT_VARIANTS[hash % FLOAT_VARIANTS.length]!,
    style: {
      animationDuration: `${7 + ((hash >>> 4) % 600) / 100}s`,
      animationDelay: `-${((hash >>> 12) % 1300) / 100}s`,
      animationDirection: (hash >>> 20) % 2 === 0 ? "alternate" : "normal",
    },
  };
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function metaLine(bubble: AgentBubble): string {
  const tokens = bubble.tokens === null ? null : `${formatContextWindowTokens(bubble.tokens)} tok`;
  const elapsed = bubble.elapsedMs === null ? null : formatDuration(bubble.elapsedMs);
  return [tokens, elapsed].filter(Boolean).join(" · ");
}

/** Hover detail for a cell; the trigger is the cell's own body. */
function CellTooltip(props: {
  readonly label: string;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger}>{props.children}</TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function AgentCell(props: {
  readonly cell: PackedCell;
  readonly bubble: AgentBubble;
  readonly attach: (element: HTMLElement | null) => void;
  /** Changes when the cell should replay its one-shot pulse. */
  readonly pulseKey: string;
  readonly pulse: "bud" | "squish" | null;
  /** Holds the bud until this cell's turn in the opening bloom. */
  readonly budDelayMs: number;
}) {
  const { cell, bubble, attach, pulseKey, pulse, budDelayMs } = props;
  const r = cell.r;
  const accent = cellAccent(bubble);
  const float = floatStyle(cell.id);
  const isRoot = cell.kind === "root";
  const meta = metaLine(bubble);
  const live = !isRoot && !cell.docked;
  const nameSize = clamp(11, r * (isRoot ? 0.3 : 0.34), 20);
  const lineSize = clamp(9.5, r * 0.25, 13);
  const tooltip = [bubble.name, bubble.subtitle, meta].filter(Boolean).join(" · ");

  return (
    <div
      ref={attach}
      className={cn("agent-cell", isRoot ? "z-20" : "z-10")}
      style={{ width: r * 2, height: r * 2 }}
      data-status={bubble.status}
    >
      {isRoot ? null : (
        <>
          {/* The neck left by the bud thins away; a thin tether stays while the child is out working. */}
          <span className="agent-cell-neck" style={{ left: r, top: r, background: accent }} />
          {live ? (
            <span className="agent-cell-tether" style={{ left: r, top: r, background: accent }} />
          ) : null}
        </>
      )}
      <div className={cn("size-full", float.className)} style={float.style}>
        <div
          key={pulseKey}
          className={cn(
            "size-full",
            pulse === "bud" && "agent-cell-bud",
            pulse === "squish" && "agent-cell-squish",
          )}
          style={
            pulse === "bud" && budDelayMs > 0 ? { animationDelay: `${budDelayMs}ms` } : undefined
          }
        >
          <CellTooltip
            label={tooltip}
            trigger={
              <div
                className={cn(
                  "agent-cell-breathe relative flex size-full flex-col items-center justify-center rounded-full border text-center",
                  bubble.status === "waiting" && "border-dashed",
                )}
                style={{
                  ...membraneStyle(accent, ENERGY[bubble.status]),
                  ...breatheStyle(cell.id),
                  ...labelInk(accent),
                }}
              />
            }
          >
            {isRoot && bubble.contextFraction !== null ? (
              <ContextRing r={r} fraction={bubble.contextFraction} compacted={bubble.compacted} />
            ) : null}
            <span
              className="truncate font-bold leading-tight"
              style={{ fontSize: nameSize, maxWidth: "85%" }}
            >
              {bubble.name}
            </span>
            {(isRoot || live) && bubble.subtitle ? (
              <span
                className="truncate font-medium leading-tight opacity-95"
                style={{ fontSize: lineSize, maxWidth: "80%" }}
              >
                {bubble.subtitle}
              </span>
            ) : null}
            {meta && (isRoot || !live) ? (
              <span
                className="truncate font-medium leading-tight tabular-nums opacity-90"
                style={{ fontSize: lineSize, maxWidth: "80%" }}
              >
                {meta}
              </span>
            ) : null}
            {bubble.satellites.map((satellite) => {
              const angle = hashedAngle(`${satellite.id}:sat`);
              const failed = satellite.status === "failed";
              return (
                <span
                  key={satellite.id}
                  className="absolute size-1.5 rounded-full"
                  style={{
                    left: r + Math.cos(angle) * (r - 1) - 3,
                    top: r + Math.sin(angle) * (r - 1) - 3,
                    background: failed
                      ? AGENT_MAP_ACCENTS.failed
                      : AGENT_MAP_CATEGORY_ACCENTS[satellite.category],
                    opacity: satellite.opacity,
                  }}
                />
              );
            })}
          </CellTooltip>
        </div>
        {cell.tasks.map((task) => (
          <TaskCell key={task.task.id} owner={r} task={task} />
        ))}
      </div>
    </div>
  );
}

const SHORT_LABELS: Record<AgentMapCategory, string> = {
  read: "Read",
  search: "Read",
  edit: "Edit",
  shell: "Shell",
  web: "Web",
  plan: "Plan",
  other: "Tool",
};

function isFolded(task: AgentMapTask): boolean {
  return task.label.startsWith("+");
}

function taskShortLabel(task: AgentMapTask): string {
  return isFolded(task) ? (task.label.split(" ")[0] ?? task.label) : SHORT_LABELS[task.category];
}

/** A small cell clinging to its owner; it buds in once when the work lands. */
function TaskCell(props: { readonly owner: number; readonly task: PackedTask }) {
  const { task, r } = props.task;
  const accent = AGENT_MAP_CATEGORY_ACCENTS[task.category];
  const duration = task.durationMs > 0 ? ` · ${formatDuration(task.durationMs)}` : "";
  return (
    <CellTooltip
      label={`${task.label}${duration}`}
      trigger={
        <div
          className="agent-cell-bud absolute flex flex-col items-center justify-center rounded-full border text-center leading-none"
          style={{
            ...membraneStyle(accent, 0.9),
            ...labelInk(accent),
            left: props.owner + props.task.dx - r,
            top: props.owner + props.task.dy - r,
            width: r * 2,
            height: r * 2,
          }}
        />
      }
    >
      {r >= 12 ? (
        <>
          <span className="font-bold" style={{ fontSize: clamp(8, r * 0.6, 10.5) }}>
            {taskShortLabel(task)}
          </span>
          {task.count > 1 && !isFolded(task) ? (
            <span className="font-semibold tabular-nums" style={{ fontSize: 7.5 }}>
              ×{task.count}
            </span>
          ) : null}
        </>
      ) : null}
    </CellTooltip>
  );
}

/** The root's context window as a gold arc just outside its membrane. */
function ContextRing(props: {
  readonly r: number;
  readonly fraction: number;
  readonly compacted: boolean;
}) {
  const size = props.r * 2 + 12;
  const centre = size / 2;
  const radius = props.r + 3;
  const length = 2 * Math.PI * radius;
  return (
    <svg
      className="pointer-events-none absolute -left-1.5 -top-1.5 overflow-visible"
      width={size}
      height={size}
      aria-hidden
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="var(--foreground)"
        strokeOpacity={0.12}
        strokeWidth={3}
      />
      <circle
        className="agent-map-ring"
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke={AGENT_MAP_ACCENTS.context}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${length * props.fraction} ${length}`}
        transform={`rotate(-90 ${centre} ${centre})`}
      />
      {props.compacted ? (
        <text
          x={centre + radius * 0.72}
          y={centre - radius * 0.72}
          fontSize={12}
          fill={AGENT_MAP_ACCENTS.context}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          ↻
        </text>
      ) : null}
    </svg>
  );
}
