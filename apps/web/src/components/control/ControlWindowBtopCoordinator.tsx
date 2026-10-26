import { useEffect, useEffectEvent } from "react";

import { useBtopSession } from "./btopSession";

/**
 * Stops btop when the desktop Control window closes. Lives in the main window
 * because a closing window's renderer cannot reliably finish an RPC as it unloads.
 */
export function ControlWindowBtopCoordinator() {
  const { environmentId, canOperate, stop } = useBtopSession();
  const onControlWindowClosed = useEffectEvent(() => {
    if (environmentId !== null && canOperate) void stop(environmentId);
  });

  useEffect(() => {
    const controlWindow = window.desktopBridge?.controlWindow;
    if (!controlWindow) return;
    return controlWindow.onStateChange((open) => {
      if (!open) onControlWindowClosed();
    });
  }, []);

  return null;
}
