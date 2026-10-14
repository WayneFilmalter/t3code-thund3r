import { AuthOrchestrationReadScope, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { providersWithLimits } from "@t3tools/shared/usageLimits";
import { memo, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { primaryServerConfigAtom, serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usageTone, usageWindowTitle } from "./SidebarClaudeUsage.logic";

const KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * The primary environment's Claude quota windows, pinned under the sidebar's
 * scroll area. It follows the pushed server config, so mid-turn rate-limit
 * events and the periodic probe land here without polling. Between those the
 * snapshot can sit stale for a while, so the header carries a manual refresh
 * that re-probes just the Claude instance. Reset times are absolute and
 * measured from the snapshot's `checkedAt`, so nothing ticks.
 */
export const SidebarClaudeUsage = memo(function SidebarClaudeUsage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const config = useAtomValue(primaryServerConfigAtom);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const canRefresh = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const claude = providersWithLimits(config?.providers ?? []).find(
    (provider) =>
      provider.driver === "claudeAgent" &&
      provider.usageLimits !== undefined &&
      provider.usageLimits.unavailable === undefined &&
      provider.usageLimits.windows.length > 0,
  );
  const instanceId = claude?.instanceId;

  const refresh = () => {
    if (environmentId === null || instanceId === undefined || refreshing) return;
    setRefreshing(true);
    // Shares the per-environment in-flight check with the Usage page, so a
    // click here while that page is already probing waits instead of
    // spawning a second Claude process.
    void refreshUsageLimits(environmentId, () =>
      refreshProviders({ environmentId, input: { instanceId } }),
    ).finally(() => setRefreshing(false));
  };

  if (!claude?.usageLimits) return null;

  // Each pushed snapshot is stamped, so "today" advances with the data.
  const now = Date.parse(claude.usageLimits.checkedAt);
  const windows = claude.usageLimits.windows.toSorted(
    (left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind],
  );

  const resetLabel = (resetsAt: string | undefined): string | null => {
    if (!resetsAt) return null;
    const formatted = formatUpcomingTimestamp(resetsAt, timestampFormat, now);
    if (!formatted) return null;
    if (formatted.startsWith("tomorrow")) return `Resets ${formatted}`;
    return isSameDay(new Date(resetsAt), new Date(now))
      ? `Resets at ${formatted}`
      : `Resets on ${formatted}`;
  };

  return (
    <div className="mb-1 flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Claude Usage</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                disabled={!canRefresh || refreshing}
                aria-busy={refreshing}
                onClick={refresh}
              >
                <RefreshIcon refreshing={refreshing} />
                <span className="sr-only">Refresh Claude usage</span>
              </Button>
            }
          />
          <TooltipPopup side="top">
            {refreshing ? "Refreshing Claude usage" : "Refresh Claude usage"}
          </TooltipPopup>
        </Tooltip>
      </div>
      {windows.map((window) => {
        const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
        const resets = resetLabel(window.resetsAt);
        return (
          <div key={window.id} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 truncate text-foreground">{usageWindowTitle(window)}</span>
              {resets ? (
                <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
                  {resets}
                </span>
              ) : null}
            </div>
            <div
              role="meter"
              aria-label={usageWindowTitle(window)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={used}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full", usageTone(used))}
                style={{ width: `${used}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{used}% used</span>
          </div>
        );
      })}
    </div>
  );
});
