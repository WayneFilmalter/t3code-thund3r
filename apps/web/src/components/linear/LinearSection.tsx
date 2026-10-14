import type { EnvironmentId, LinearIssueStatus } from "@t3tools/contracts";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";

import { LinearIssueBubble } from "./LinearIssueBubble";
import { STATUS_TONES } from "./linearTones";
import { sectionState } from "./linearPanel.logic";

/**
 * One status of the Linear tab: a workflow-style header that folds the list,
 * plus its own fetch button. Nothing is requested until the section is armed,
 * by the first expand, its fetch button, or the panel's fetch-all. The
 * component stays mounted while folded so the fetched issues stay subscribed.
 */
export function LinearSection(props: {
  status: LinearIssueStatus;
  label: string;
  environmentId: EnvironmentId;
  /** Bumped by the panel's fetch-all; each bump fetches this section. */
  fetchRevision: number;
  onOpen: (url: string) => void;
}) {
  const { status, environmentId, fetchRevision } = props;
  const tone = STATUS_TONES[status];
  const [open, setOpen] = useState(false);
  const [armedHere, setArmedHere] = useState(false);
  // A fetch-all bump arms every section; creating the atom is itself the first fetch.
  const armed = armedHere || fetchRevision > 0;
  const atom = useMemo(
    () => (armed ? linearEnvironment.issues({ environmentId, input: { status } }) : null),
    [armed, environmentId, status],
  );
  const query = useEnvironmentQuery(atom);
  const { refresh } = query;

  // Later bumps refetch a section that was already armed; the first bump's fetch came from the atom.
  const seenRevision = useRef(fetchRevision);
  useEffect(() => {
    if (fetchRevision === seenRevision.current) return;
    const wasArmed = armedHere || seenRevision.current > 0;
    seenRevision.current = fetchRevision;
    if (wasArmed) refresh();
  }, [armedHere, fetchRevision, refresh]);

  const issues = query.data?.issues ?? null;
  const state = sectionState({ armed, isPending: query.isPending, error: query.error, issues });
  const count = issues === null ? null : issues.length;

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !armed) setArmedHere(true);
      }}
    >
      <div className="mb-2 mt-4 flex items-center gap-1 px-1 first:mt-1">
        <CollapsibleTrigger
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left"
          aria-label={`${open ? "Collapse" : "Expand"} ${props.label}`}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
              tone.label,
              open && "rotate-90",
            )}
          />
          <span className={cn("text-xs font-semibold uppercase tracking-wider", tone.label)}>
            {props.label}
          </span>
          <span aria-hidden className={cn("h-px flex-1", tone.rule)} />
          <span className={cn("text-xs font-medium tabular-nums", tone.label)}>
            {count === null ? "–" : count}
          </span>
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                aria-label={`Fetch ${props.label}`}
                disabled={query.isPending}
                onClick={() => {
                  if (armed) refresh();
                  else setArmedHere(true);
                }}
              />
            }
          >
            {query.isPending ? (
              <Spinner className="size-3" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
          </TooltipTrigger>
          <TooltipPopup>
            <p>Fetch {props.label}</p>
          </TooltipPopup>
        </Tooltip>
      </div>
      <CollapsiblePanel>
        {state === "ready" && issues ? (
          <div className="flex flex-col gap-1.5 pb-1">
            {query.error ? <p className="px-1 text-xs text-destructive">{query.error}</p> : null}
            {issues.map((issue) => (
              <LinearIssueBubble key={issue.id} issue={issue} onOpen={props.onOpen} />
            ))}
          </div>
        ) : (
          <p
            className={cn(
              "px-1 pb-1 text-xs",
              state === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {state === "idle"
              ? "Not fetched yet."
              : state === "loading"
                ? "Fetching from Linear…"
                : state === "error"
                  ? query.error
                  : "No issues."}
          </p>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}
