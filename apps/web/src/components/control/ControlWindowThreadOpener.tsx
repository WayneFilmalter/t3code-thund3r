import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Shows the threads the desktop Control window asks for, such as a workflow's
 * last run. Lives in the main window, which the desktop shell brings forward.
 */
export function ControlWindowThreadOpener() {
  const navigate = useNavigate();

  useEffect(() => {
    const subscribe = window.desktopBridge?.controlWindow?.onOpenThread;
    if (!subscribe) return;
    return subscribe((ref) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: EnvironmentId.make(ref.environmentId),
          threadId: ThreadId.make(ref.threadId),
        },
      });
    });
  }, [navigate]);

  return null;
}
