import { AGENT_MAP_LEGEND } from "./agentMapColors";

export function AgentMapLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-2xs text-muted-foreground">
      {AGENT_MAP_LEGEND.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5">
          {entry.icon ? (
            <entry.icon aria-hidden className="size-3" style={{ color: entry.accent }} />
          ) : entry.line ? (
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: entry.accent }}
            />
          ) : (
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: entry.accent }}
            />
          )}
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
