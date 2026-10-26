import type { EnvironmentId, LinearTicket } from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { PRIORITY_TONES } from "../../linear/linearTones";
import {
  CommentBox,
  CommentToggle,
  DoneButton,
  TicketBranchIcon,
  TicketIdentifierChip,
  TicketLinks,
  TicketPriorityBadge,
  TicketStateChip,
} from "./TicketParts";

/**
 * One priority. The border, a faint wash, and the strip down the left edge
 * all take the ticket's priority colour, so the list reads at a glance; the
 * workflow state keeps its own colour in the chip. Done sits top right, the
 * ticket's links bottom right. A red dot means someone else commented since
 * the ticket was last opened, and a blue glowing border that you are
 * @-mentioned in it. The glow is a static shadow, not an animation, so it
 * costs nothing per frame.
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
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-lg border transition-colors hover:bg-card",
        ticket.mentionsViewer ? "border-info bg-card/60 shadow-mention-glow" : tone.card,
      )}
    >
      {ticket.mentionsViewer ? <span className="sr-only">Mentions you.</span> : null}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", tone.dot ?? "bg-border")}
      />
      <div className="flex items-start gap-1 pt-1.5 pr-1.5 pl-4">
        <button
          type="button"
          onClick={props.onOpen}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5 pt-0.5 text-left"
        >
          <TicketIdentifierChip identifier={ticket.identifier} />
          <span className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
            {ticket.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <TicketStateChip ticket={ticket} />
            <TicketPriorityBadge ticket={ticket} />
            <TicketBranchIcon ticket={ticket} />
          </span>
        </button>
        {props.unread ? (
          <span
            role="img"
            aria-label="New comments"
            className="mt-2 size-2 shrink-0 rounded-full bg-destructive ring-2 ring-destructive/20"
          />
        ) : null}
        <DoneButton checking={props.checkingDone} onDone={props.onDone} />
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 pt-1 pb-1.5 pl-3">
        <CommentToggle
          allowed={props.canComment}
          open={props.commenting}
          onToggle={props.onToggleComment}
        />
        <TicketLinks ticket={ticket} />
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
