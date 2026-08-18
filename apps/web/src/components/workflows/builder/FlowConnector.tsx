import { PlusIcon } from "lucide-react";

import type { WorkflowPaletteItemId } from "~/workflows/workflowNodeMeta";

import { NodePaletteMenu } from "./NodePaletteMenu";

/**
 * The arrow between two bubbles: a short line with an arrowhead, and in edit mode a "+" in
 * the middle that opens the node palette. Static SVG, no measurement, no repaint.
 */
export function FlowConnector(props: {
  accent: string;
  onInsert?: ((item: WorkflowPaletteItemId) => void) | undefined;
  /** Hidden lanes disable inserting nested fan-outs. */
  allowFanOut?: boolean;
}) {
  return (
    <div
      className="relative flex h-9 w-full shrink-0 items-center justify-center"
      aria-hidden={!props.onInsert}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
      >
        <line
          x1="50"
          y1="0"
          x2="50"
          y2="28"
          stroke={props.accent}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <svg
        className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2"
        width="12"
        height="8"
        viewBox="0 0 12 8"
      >
        <polygon points="0,0 12,0 6,8" fill={props.accent} />
      </svg>
      {props.onInsert ? (
        <NodePaletteMenu onPick={props.onInsert} allowFanOut={props.allowFanOut ?? true}>
          <button
            type="button"
            aria-label="Insert step"
            className="relative z-10 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:text-foreground"
            style={{ borderColor: props.accent }}
          >
            <PlusIcon className="size-3" />
          </button>
        </NodePaletteMenu>
      ) : null}
    </div>
  );
}
