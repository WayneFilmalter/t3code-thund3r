import { taskLabel } from "@t3tools/shared/priorityTasks";
import { useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { TASK_TONE } from "../../linear/linearTones";
import type { TaskEntry } from "./prioritiesStore";
import { DoneButton, TicketIdentifierChip, TicketPriorityBadge } from "./TicketParts";

/**
 * One task. The border, wash and left strip are always purple, so tasks
 * stand apart from tickets, whose border takes their priority colour; the
 * priority shows as a badge instead. Clicking shows the whole description.
 * The age bottom right moves on with the shared minute clock.
 */
export function TaskCard(props: { task: TaskEntry; onDone: () => void }) {
  const { task } = props;
  const [expanded, setExpanded] = useState(false);
  // Re-renders each minute so the age stays true.
  useNowMinute();
  const hasBody = task.body.length > 0;
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-lg border transition-colors hover:bg-card",
        TASK_TONE.card,
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", TASK_TONE.dot)} />
      <div className="flex items-start gap-1 pt-1.5 pr-1.5 pl-4">
        <button
          type="button"
          disabled={!hasBody}
          aria-expanded={hasBody ? expanded : undefined}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 flex-col gap-1.5 text-left enabled:cursor-pointer"
        >
          <TicketIdentifierChip identifier={taskLabel(task.number)} />
          <span className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
            {task.title}
          </span>
          {hasBody ? (
            <span
              className={cn(
                "text-xs whitespace-pre-wrap text-muted-foreground",
                !expanded && "line-clamp-3",
              )}
            >
              {task.body}
            </span>
          ) : null}
        </button>
        <DoneButton checking={false} onDone={props.onDone} />
      </div>
      <div className="flex items-center gap-1.5 pt-1.5 pr-2.5 pb-1.5 pl-4">
        <TicketPriorityBadge ticket={task} />
        <Tooltip>
          <TooltipTrigger
            render={
              <time
                dateTime={task.createdAt}
                className="ml-auto text-2xs tabular-nums text-muted-foreground"
              />
            }
          >
            {formatRelativeTimeLabel(task.createdAt)}
          </TooltipTrigger>
          <TooltipPopup>
            <p>Added {new Date(task.createdAt).toLocaleString()}</p>
          </TooltipPopup>
        </Tooltip>
      </div>
    </li>
  );
}
