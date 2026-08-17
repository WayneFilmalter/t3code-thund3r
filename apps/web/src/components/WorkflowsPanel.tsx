import { Workflow } from "lucide-react";

/**
 * Workflows right-panel surface. The first tab in the panel and its default
 * landing spot; a placeholder until the workflow environment lands here.
 */
export function WorkflowsPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <Workflow className="size-6 text-muted-foreground" aria-hidden />
      <h3 className="mt-3 font-medium text-foreground text-sm">Workflows</h3>
      <p className="mt-1 max-w-xs text-muted-foreground text-xs leading-relaxed">
        Build and run agent workflows in this workspace. Coming soon.
      </p>
    </div>
  );
}
