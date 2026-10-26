import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, LinearError, type LinearTicket } from "@t3tools/contracts";
import { orderPriorityItems, taskLabel } from "@t3tools/shared/priorityTasks";
import * as Schema from "effect/Schema";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { WorkflowsSubheader } from "../../workflows/WorkflowsSubheader";
import { MissingPriorityCard, PendingPriorityCard, PriorityCard } from "./PriorityCard";
import { PriorityDetail } from "./PriorityDetail";
import { hasUnreadComments, isTicketDone } from "./priorities.logic";
import { type TaskEntry, usePriorityList, usePriorityTasks } from "./prioritiesStore";
import { TaskCard } from "./TaskCard";

const isLinearError = Schema.is(LinearError);

/** New comments and status changes show up within a minute while the window is open. */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * Control window panel 1: the priority list of Linear tickets and plain
 * tasks, most urgent first. Both are added from the Control tab's
 * Priorities and Tasks blocks; Done takes them off.
 */
export function PrioritiesPanel() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return <PanelMessage>No local server.</PanelMessage>;
  return <Priorities environmentId={environmentId} />;
}

function PanelMessage({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Priorities({ environmentId }: { environmentId: EnvironmentId }) {
  const list = usePriorityList(environmentId);
  const taskList = usePriorityTasks(environmentId);
  const identifiers = useMemo(() => list.entries.map((entry) => entry.identifier), [list.entries]);
  const query = useEnvironmentQuery(
    identifiers.length === 0
      ? null
      : linearEnvironment.tickets({ environmentId, input: { identifiers } }),
  );
  const canComment = useAtomValue(linearEnvironment.createComment.permissionAtom(environmentId));
  const resolveTickets = useAtomCommand(linearEnvironment.resolveTickets);

  // Tickets survive a change of list, so adding one does not blank the rest while it
  // loads. Folded in during render when a new result lands, not in an effect.
  const [cache, setCache] = useState<{
    readonly source: typeof query.data;
    readonly known: ReadonlyMap<string, LinearTicket>;
    readonly missing: ReadonlySet<string>;
  }>(() => ({ source: null, known: new Map(), missing: new Set() }));
  if (query.data !== null && query.data !== cache.source) {
    const known = new Map(cache.known);
    for (const ticket of query.data.tickets) known.set(ticket.identifier, ticket);
    setCache({ source: query.data, known, missing: new Set(query.data.missing) });
  }
  const { known, missing } = cache;

  const { refresh } = query;
  useEffect(() => {
    if (identifiers.length === 0) return;
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [identifiers.length, refresh]);

  const [openIdentifier, setOpenIdentifier] = useState<string | null>(null);
  const [commentingIdentifier, setCommentingIdentifier] = useState<string | null>(null);
  const [checkingIdentifier, setCheckingIdentifier] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ identifier: string; state: string } | null>(
    null,
  );

  const { remove, markSeen } = list;
  const removePriority = useCallback(
    (identifier: string) => {
      remove(identifier);
      setOpenIdentifier((current) => (current === identifier ? null : current));
    },
    [remove],
  );

  /** Done reads the ticket fresh, so a status changed in Linear a moment ago counts. */
  const markDone = async (identifier: string) => {
    setCheckingIdentifier(identifier);
    try {
      const result = await resolveTickets({ environmentId, input: { identifiers: [identifier] } });
      if (result._tag !== "Success") return;
      const ticket = result.value.tickets[0];
      if (ticket !== undefined && isTicketDone(ticket)) {
        removePriority(identifier);
      } else {
        setConfirmRemove({ identifier, state: ticket?.stateName ?? "not found in Linear" });
      }
    } finally {
      setCheckingIdentifier(null);
    }
  };

  /** No Linear state to check, so a task goes at once; Undo brings it back under its number. */
  const { remove: removeTask, restore: restoreTask } = taskList;
  const markTaskDone = useCallback(
    (task: TaskEntry) => {
      void removeTask(task.id);
      const toastId = toastManager.add({
        type: "success",
        title: `Done: ${taskLabel(task.number)} ${task.title}`,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            void restoreTask(task);
          },
        },
      });
    },
    [removeTask, restoreTask],
  );

  const openEntry = list.entries.find((entry) => entry.identifier === openIdentifier);
  const openTicket = openIdentifier === null ? undefined : known.get(openIdentifier);
  const onSeen = useCallback(
    (latest: string | null) => {
      if (openIdentifier !== null) markSeen(openIdentifier, latest);
    },
    [markSeen, openIdentifier],
  );

  const confirmDialog = (
    <AlertDialog
      open={confirmRemove !== null}
      onOpenChange={(open) => {
        if (!open) setConfirmRemove(null);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {confirmRemove?.identifier}?</AlertDialogTitle>
          <AlertDialogDescription>
            The ticket is not marked as done yet ({confirmRemove?.state}). Are you sure you want to
            remove this from the priority list?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirmRemove !== null) removePriority(confirmRemove.identifier);
              setConfirmRemove(null);
            }}
          >
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );

  if (openEntry !== undefined && openTicket !== undefined) {
    return (
      <>
        <PriorityDetail
          environmentId={environmentId}
          ticket={openTicket}
          canComment={canComment}
          checkingDone={checkingIdentifier === openTicket.identifier}
          onBack={() => setOpenIdentifier(null)}
          onDone={() => void markDone(openTicket.identifier)}
          onSeen={onSeen}
          onCommented={refresh}
        />
        {confirmDialog}
      </>
    );
  }

  const count = list.entries.length + taskList.tasks.length;
  const linearNotice =
    list.entries.length === 0
      ? null
      : isLinearError(query.failure) && query.failure.kind === "not-configured"
        ? "Add a Linear API key in Settings → Integrations."
        : known.size === 0 && query.error !== null
          ? query.error
          : null;
  // Tasks need no Linear, so a Linear problem only replaces the list when there are none.
  const notice =
    count === 0
      ? "No priorities yet. Add tickets or tasks from the Control tab."
      : taskList.tasks.length === 0
        ? linearNotice
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-foreground">
          Priorities
          {count > 0 ? (
            <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </span>
        {query.error !== null && known.size > 0 ? (
          <span className="min-w-0 truncate text-xs text-destructive">{query.error}</span>
        ) : null}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Refresh from Linear"
          disabled={identifiers.length === 0 || query.isPending}
          onClick={refresh}
        >
          <RefreshCwIcon />
        </Button>
      </WorkflowsSubheader>
      {notice !== null ? (
        <PanelMessage>{notice}</PanelMessage>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 *:shrink-0">
          {linearNotice !== null ? (
            <li className="px-1 text-xs text-muted-foreground">{linearNotice}</li>
          ) : null}
          {orderPriorityItems(list.entries, taskList.tasks, known).map((item) => {
            if (item.kind === "task") {
              return (
                <TaskCard
                  key={item.task.id}
                  task={item.task}
                  onDone={() => markTaskDone(item.task)}
                />
              );
            }
            const { entry } = item;
            const ticket = known.get(entry.identifier);
            if (ticket === undefined) {
              return missing.has(entry.identifier) ? (
                <MissingPriorityCard
                  key={entry.identifier}
                  identifier={entry.identifier}
                  onRemove={() => removePriority(entry.identifier)}
                />
              ) : (
                <PendingPriorityCard key={entry.identifier} identifier={entry.identifier} />
              );
            }
            return (
              <PriorityCard
                key={entry.identifier}
                environmentId={environmentId}
                ticket={ticket}
                unread={hasUnreadComments(ticket, entry)}
                canComment={canComment}
                commenting={commentingIdentifier === entry.identifier}
                checkingDone={checkingIdentifier === entry.identifier}
                onOpen={() => {
                  setCommentingIdentifier(null);
                  setOpenIdentifier(entry.identifier);
                }}
                onToggleComment={() =>
                  setCommentingIdentifier((current) =>
                    current === entry.identifier ? null : entry.identifier,
                  )
                }
                onCommentDone={() => setCommentingIdentifier(null)}
                onDone={() => void markDone(entry.identifier)}
              />
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
