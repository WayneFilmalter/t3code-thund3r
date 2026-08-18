import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ArrowLeftIcon, History } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { formatDayAwareTimestamp, formatElapsedDurationLabel } from "~/timestampFormat";

import { WorkflowBubble } from "./WorkflowBubble";
import { WorkflowsSubheader } from "./WorkflowsSubheader";
import type { WorkflowBubbleAction, WorkflowSectionItem } from "./workflowsPanel.logic";

/** "Ran yesterday at 3:12 PM · 25m": when it ran and how long it took. */
export function formatHistoryDetail(
  run: { startedAt: string; finishedAt: string | null },
  timestampFormat: TimestampFormat,
): string {
  const ran = formatDayAwareTimestamp(run.startedAt, timestampFormat);
  const finishedMs = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  const took = Number.isNaN(finishedMs)
    ? ""
    : formatElapsedDurationLabel(run.startedAt, finishedMs);
  return took ? `Ran ${ran} · ${took}` : `Ran ${ran}`;
}

/**
 * The full Done history, reached from the Done section's "View all". Every finished run,
 * newest first, with when it ran and how long it took — the place to go back and check what
 * happened when.
 */
export function WorkflowHistoryPanel({
  items,
  timestampFormat,
  onBack,
  onAction,
}: {
  items: readonly WorkflowSectionItem[];
  timestampFormat: TimestampFormat;
  onBack: () => void;
  onAction: (item: WorkflowSectionItem, action: WorkflowBubbleAction) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          History
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </WorkflowsSubheader>
      {items.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <History className="size-4.5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Nothing finished yet</EmptyTitle>
            <EmptyDescription>
              Workflows that have run and been put away land here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <div className="flex flex-col gap-1.5">
            {items.map((item) =>
              item.kind === "run" ? (
                <WorkflowBubble
                  key={item.run.id}
                  item={item}
                  sectionId="done"
                  detail={formatHistoryDetail(item.run, timestampFormat)}
                  onAction={(action) => onAction(item, action)}
                />
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
}
