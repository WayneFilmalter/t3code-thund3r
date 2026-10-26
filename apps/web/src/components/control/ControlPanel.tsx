import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { DesktopBridge, EnvironmentId } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { type ReactNode, useContext, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { SlackSettings } from "../settings/SlackSettings";
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

/** One titled block of the Control tab, with its actions on the right of the title. */
function ControlBlock(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-xs font-medium">{props.title}</h3>
        {props.actions ? <div className="flex shrink-0 gap-2">{props.actions}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

/**
 * Slack's connection and the feed's Refetch. Reading the feed here keeps the
 * server's Slack connection open while the tab shows, which is what makes the
 * status line live.
 */
function SlackBlock({ environmentId }: { environmentId: EnvironmentId }) {
  const slack = useEnvironmentSettings(environmentId, (settings) => settings.slack);
  const configured = slack.userToken.length > 0 && slack.appToken.length > 0;
  const feed = useEnvironmentQuery(
    configured ? serverEnvironment.slackFeed({ environmentId, input: null }) : null,
  );
  const canRefetch = useAtomValue(serverEnvironment.slackRefetch.permissionAtom(environmentId));
  const refetch = useAtomCommand(serverEnvironment.slackRefetch, { label: "refetch Slack" });
  useNowMinute();
  const status = feed.data?.status ?? null;

  const statusLine =
    status === null
      ? "Connecting…"
      : status.state === "live"
        ? [
            "Live",
            status.selfName && status.teamName ? `${status.selfName} @ ${status.teamName}` : null,
            status.fetchedAt ? `fetched ${formatRelativeTimeLabel(status.fetchedAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : status.state === "error"
          ? (status.detail ?? "Slack is unreachable.")
          : status.state === "connecting"
            ? "Connecting…"
            : "Not connected.";

  return (
    <ControlBlock
      title="Slack"
      actions={
        configured ? (
          <Button
            size="compact"
            variant="outline"
            disabled={!canRefetch || status?.state === "connecting"}
            onClick={() => void refetch({ environmentId, input: {} })}
          >
            <RefreshCwIcon />
            Refetch
          </Button>
        ) : null
      }
    >
      {configured ? (
        <p
          className={
            status?.state === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {statusLine}
        </p>
      ) : (
        <SlackSettings environmentId={environmentId} />
      )}
    </ControlBlock>
  );
}

/** The Control tab: the desktop Control window, this PC's stats and btop, and the Slack feed. */
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
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <ControlBlock
          title="Control window"
          actions={
            <>
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
            </>
          }
        >
          <p className="text-xs text-muted-foreground">
            {!bridge
              ? "Requires the desktop app."
              : open
                ? "The window is open."
                : "The window is closed."}
          </p>
        </ControlBlock>
        <ControlBlock
          title="This PC"
          actions={
            <Button
              size="compact"
              variant="outline"
              disabled={!open || !btop.canOperate || btop.cwd === null || restartingBtop}
              onClick={restartBtop}
            >
              Refresh btop
            </Button>
          }
        >
          {btop.environmentId === null ? (
            <p className="text-xs text-muted-foreground">No local server.</p>
          ) : (
            <HostStats environmentId={btop.environmentId} />
          )}
        </ControlBlock>
        {btop.environmentId !== null ? <SlackBlock environmentId={btop.environmentId} /> : null}
      </div>
    </div>
  );
}
