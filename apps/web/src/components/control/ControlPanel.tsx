import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { DesktopBridge, EnvironmentId } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { type ReactNode, useContext, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { SlackSettings } from "../settings/SlackSettings";
import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { useBtopSession } from "./btopSession";
import { SlackChannelToggles } from "./SlackChannelToggles";
import { PrioritiesAdder } from "./priorities/PrioritiesAdder";

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

/** Background tint for the This PC block, following CPU load. */
function cpuLoadTint(cpuUtilization: number | null): string | undefined {
  if (cpuUtilization === null) return undefined;
  if (cpuUtilization >= 0.8) return "bg-destructive/12";
  if (cpuUtilization >= 0.5) return "bg-warning/12";
  return "bg-success/8";
}

function usedOfTotalGb(available: number, total: number): string {
  return `${((total - available) / BYTES_PER_GB).toFixed(1)} / ${(total / BYTES_PER_GB).toFixed(1)} GB`;
}

/** The This PC block, with the Refresh btop button as its action. */
function ThisPcBlock(props: { environmentId: EnvironmentId | null; actions: ReactNode }) {
  return props.environmentId === null ? (
    <ControlBlock title="This PC" actions={props.actions}>
      <p className="text-xs text-muted-foreground">No local server.</p>
    </ControlBlock>
  ) : (
    <HostStatsBlock environmentId={props.environmentId} actions={props.actions} />
  );
}

/**
 * CPU, memory and disk for the machine behind an environment, tinted by CPU
 * load. Polls only while mounted, i.e. while the Control tab is showing; the
 * server caches samples.
 */
function HostStatsBlock({
  environmentId,
  actions,
}: {
  environmentId: EnvironmentId;
  actions: ReactNode;
}) {
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
      <ControlBlock title="This PC" actions={actions}>
        <p className="text-xs text-muted-foreground">
          {result._tag === "Failure" ? "Stats unavailable." : "Reading stats…"}
        </p>
      </ControlBlock>
    );
  }
  const {
    cpuUtilization,
    cpuCount,
    availableMemoryBytes,
    totalMemoryBytes,
    availableDiskBytes,
    totalDiskBytes,
  } = result.value;
  return (
    <ControlBlock title="This PC" actions={actions} className={cpuLoadTint(cpuUtilization)}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">CPU</dt>
        <dd className="tabular-nums">
          {cpuUtilization === null ? "—" : `${Math.round(cpuUtilization * 100)}%`} · {cpuCount}{" "}
          cores
        </dd>
        <dt className="text-muted-foreground">Memory</dt>
        <dd className="tabular-nums">{usedOfTotalGb(availableMemoryBytes, totalMemoryBytes)}</dd>
        <dt className="text-muted-foreground">Disk</dt>
        <dd className="tabular-nums">
          {availableDiskBytes === null || totalDiskBytes === null
            ? "—"
            : usedOfTotalGb(availableDiskBytes, totalDiskBytes)}
        </dd>
      </dl>
    </ControlBlock>
  );
}

/** One titled block of the Control tab, with its actions on the right of the title. */
function ControlBlock(props: {
  title: string;
  actions?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("flex flex-col gap-2 rounded-lg border border-border/70 p-3", props.className)}
    >
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
        <>
          <p
            className={
              status?.state === "error"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {statusLine}
          </p>
          {feed.data !== null ? (
            <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
              <span className="text-xs font-medium">Channels</span>
              <SlackChannelToggles environmentId={environmentId} messages={feed.data.messages} />
            </div>
          ) : null}
        </>
      ) : (
        <SlackSettings environmentId={environmentId} />
      )}
    </ControlBlock>
  );
}

/**
 * The Control tab: the desktop Control window, this PC's stats and btop, the
 * priority list's lookup and paste import, and the Slack feed.
 */
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
        <ThisPcBlock
          environmentId={btop.environmentId}
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
        />
        {btop.environmentId !== null ? (
          <ControlBlock title="Priorities">
            <PrioritiesAdder environmentId={btop.environmentId} />
          </ControlBlock>
        ) : null}
        {btop.environmentId !== null ? <SlackBlock environmentId={btop.environmentId} /> : null}
      </div>
    </div>
  );
}
