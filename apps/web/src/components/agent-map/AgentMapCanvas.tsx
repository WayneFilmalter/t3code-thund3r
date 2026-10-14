import type { AgentMapLayout } from "./agentMapLayout";
import { AgentBubbleView } from "./AgentBubble";
import { AGENT_MAP_ACCENTS } from "./agentMapColors";

/** The whole constellation as one SVG. Floats only while the thread is live and motion is on. */
export function AgentMapCanvas(props: {
  readonly layout: AgentMapLayout;
  readonly live: boolean;
  readonly animated: boolean;
}) {
  const { layout } = props;
  const origin = { x: layout.root.x, y: layout.root.y };
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="h-full w-full text-foreground"
      role="img"
      aria-label={`${layout.root.bubble.name}, ${layout.root.bubble.status}, ${layout.children.length} subagents`}
      data-animated={props.animated ? "true" : "false"}
    >
      <g className={props.animated && props.live ? "agent-map-float" : undefined}>
        {layout.children.map((child) => (
          <line
            key={`link:${child.bubble.id}`}
            x1={layout.root.x}
            y1={layout.root.y}
            x2={child.x}
            y2={child.y}
            stroke={
              child.bubble.status === "failed"
                ? AGENT_MAP_ACCENTS.failed
                : AGENT_MAP_ACCENTS.subagent
            }
            strokeOpacity={child.docked ? 0.35 : 0.6}
            strokeWidth={1}
            strokeDasharray={child.docked ? "2 3" : "5 4"}
          />
        ))}
        <AgentBubbleView
          placed={layout.root}
          origin={null}
          animated={props.animated}
          live={props.live}
        />
        {layout.children.map((child) => (
          <AgentBubbleView
            key={child.docked ? `${child.bubble.id}:docked` : child.bubble.id}
            placed={child}
            origin={origin}
            animated={props.animated}
            live={props.live}
          />
        ))}
      </g>
    </svg>
  );
}
