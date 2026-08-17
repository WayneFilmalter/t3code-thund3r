import type { ReactNode } from "react";

/**
 * The Workflows surface's header row, in the shared right-panel subheader shape the browser
 * and files surfaces use so the panel's rows line up whichever tab is showing.
 */
export function WorkflowsSubheader({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
      data-surface-subheader
    >
      {children}
    </div>
  );
}
