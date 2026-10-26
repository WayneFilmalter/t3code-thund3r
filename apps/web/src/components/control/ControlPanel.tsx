import type { DesktopBridge } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";

type ControlWindowBridge = NonNullable<DesktopBridge["controlWindow"]>;

/** Follows whether the desktop Control window is open, in this or any other app window. */
function useControlWindowOpen(bridge: ControlWindowBridge | undefined): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onStateChange(setOpen);
    void bridge.isOpen().then((value) => {
      if (active) setOpen(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  return open;
}

/** The Control tab: opens and closes the desktop Control window. */
export function ControlPanel() {
  const bridge = window.desktopBridge?.controlWindow;
  const open = useControlWindowOpen(bridge);

  const run = (operation: () => Promise<void>, failureTitle: string) => {
    operation().catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: failureTitle,
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          Control
        </span>
      </WorkflowsSubheader>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex gap-2">
          <Button
            size="compact"
            disabled={!bridge || open}
            onClick={() => bridge && run(bridge.open, "Unable to open the control window")}
          >
            Open window
          </Button>
          <Button
            size="compact"
            variant="outline"
            disabled={!bridge || !open}
            onClick={() => bridge && run(bridge.close, "Unable to close the control window")}
          >
            Close window
          </Button>
        </div>
        {!bridge && <p className="text-xs text-muted-foreground">Requires the desktop app.</p>}
      </div>
    </div>
  );
}
