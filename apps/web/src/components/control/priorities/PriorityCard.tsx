import type { EnvironmentId, LinearTicket } from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { PRIORITY_TONES } from "../../linear/linearTones";
import { CommentBox, TicketActions, TicketPriorityBadge, TicketStateChip } from "./TicketParts";

/**
 * One priority. The border takes the ticket's priority colour, or its
 * workflow state's when it has none, and a strip down the left edge always
 * carries the state colour, so the list reads at a glance. A red dot means
 * someone else commented since the ticket was last opened.
 */
export function PriorityCard(props: {
  environmentId: EnvironmentId;
  ticket: LinearTicket;
  unread: boolean;
  canComment: boolean;
  commenting: boolean;
  checkingDone: boolean;
  onOpen: () => void;
  onToggleComment: () => void;
  onCommentDone: () => void;
  onDone: () => void;
}) {
  const { ticket } = props;
  const tone = PRIORITY_TONES[ticket.priority];
  const tintedBorder =
    ticket.priority === "none"
      ? { borderColor: `color-mix(in srgb, ${ticket.stateColor} 45%, transparent)` }
      : undefined;
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card/60 transition-colors hover:bg-card",
        tone.bubble,
      )}
      style={tintedBorder}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: ticket.stateColor }}
      />
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full cursor-pointer flex-col gap-1.5 pt-2 pr-3 pl-4 text-left"
      >
        <span className="flex items-start gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium text-foreground">
            {ticket.title}
          </span>
          {props.unread ? (
            <span
              role="img"
              aria-label="New comments"
              className="mt-1 size-2 shrink-0 rounded-full bg-destructive ring-2 ring-destructive/20"
            />
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {ticket.identifier}
          </span>
          <TicketStateChip ticket={ticket} />
          <TicketPriorityBadge ticket={ticket} />
        </span>
      </button>
      <div className="px-2 pt-1 pb-1.5 pl-3">
        <TicketActions
          ticket={ticket}
          checkingDone={props.checkingDone}
          comment={{
            allowed: props.canComment,
            open: props.commenting,
            toggle: props.onToggleComment,
          }}
          onDone={props.onDone}
        />
      </div>
      {props.commenting ? (
        <div className="border-t border-border/60 p-2 pl-3">
          <CommentBox
            environmentId={props.environmentId}
            ticket={ticket}
            autoFocus
            onSent={props.onCommentDone}
            onCancel={props.onCommentDone}
          />
        </div>
      ) : null}
    </li>
  );
}

/** A listed ticket Linear no longer returns: deleted, moved, or never existed. */
export function MissingPriorityCard(props: { identifier: string; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        <span className="font-medium">{props.identifier}</span> · not found in Linear
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Remove ${props.identifier}`}
        onClick={props.onRemove}
      >
        <XIcon />
      </Button>
    </li>
  );
}

/** Holds a ticket's place while its first read is in flight. */
export function PendingPriorityCard({ identifier }: { identifier: string }) {
  return (
    <li className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
      {identifier} · loading…
    </li>
  );
}
