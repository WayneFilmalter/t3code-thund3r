import { useEffect } from "react";

import { useWorkflowsStore } from "~/workflowsStore";
import { getWorkflowRunner } from "~/workflows/workflowRunnerSingleton";

/**
 * Headless: starts the workflow runner once the primary environment is authenticated so
 * unfinished runs resume against live thread state. Rendered from the root route.
 */
export function WorkflowRunnerBootstrap() {
  useEffect(() => {
    const start = () => getWorkflowRunner().start();
    if (useWorkflowsStore.persist.hasHydrated()) {
      start();
      return undefined;
    }
    return useWorkflowsStore.persist.onFinishHydration(start);
  }, []);
  return null;
}
