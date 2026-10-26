import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { DesktopBridge, EnvironmentId } from "@t3tools/contracts";
import { useContext, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { serverEnvironment } from "~/state/server";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { useBtopSession } from "./btopSession";

const HOST_STATS_POLL_MS = 5_000;
const BYTES_PER_GB = 1024 ** 3;

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

/**
 * CPU and memory for the machine behind an environment. Polls only while
 * mounted, i.e. while the Control tab is showing; the server caches samples.
 */
function HostStats({ environmentId }: { environmentId: EnvironmentId }) {
  const registry = useContext(RegistryContext);
  const result = useAtomValue(serverEnvironment.hostResources({ environmentId, input: {} }));

  useEffect(() => {
    const interval = window.setInterval(() => {
      registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
    }, HOST_STATS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [environmentId, registry]);

  if (result._tag !== "Success") {
    return (
      <p className="text-xs text-muted-foreground">
        {result._tag === "Failure" ? "Stats unavailable." : "Reading stats…"}
      </p>
    );
  }
  const { cpuUtilization, cpuCount, availableMemoryBytes, totalMemoryBytes } = result.value;
  const usedGb = (totalMemoryBytes - availableMemoryBytes) / BYTES_PER_GB;
  const totalGb = totalMemoryBytes / BYTES_PER_GB;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">CPU</dt>
      <dd className="tabular-nums">
        {cpuUtilization === null ? "—" : `${Math.round(cpuUtilization * 100)}%`} · {cpuCount} cores
      </dd>
      <dt className="text-muted-foreground">Memory</dt>
      <dd className="tabular-nums">
        {usedGb.toFixed(1)} / {totalGb.toFixed(1)} GB
      </dd>
    </dl>
  );
}

/** The Control tab: opens and closes the desktop Control window and restarts its btop panel. */
export function ControlPanel() {
  const bridge = window.desktopBridge?.controlWindow;
  const open = useControlWindowOpen(bridge);
  const btop = useBtopSession();
  const [restartingBtop, setRestartingBtop] = useState(false);

  const restartBtop = () => {
    setRestartingBtop(true);
    void btop
      .start()
      .then((started) => {
        if (!started) {
          toastManager.add({ type: "error", title: "Unable to restart btop" });
        }
      })
      .finally(() => setRestartingBtop(false));
  };

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
        <section className="mt-2 flex flex-col gap-2 rounded-lg border border-border/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium">This PC</h3>
            <Button
              size="compact"
              variant="outline"
              disabled={!open || !btop.canOperate || btop.cwd === null || restartingBtop}
              onClick={restartBtop}
            >
              Refresh btop
            </Button>
          </div>
          {btop.environmentId === null ? (
            <p className="text-xs text-muted-foreground">No local server.</p>
          ) : (
            <HostStats environmentId={btop.environmentId} />
          )}
        </section>
      </div>
    </div>
  );
}
