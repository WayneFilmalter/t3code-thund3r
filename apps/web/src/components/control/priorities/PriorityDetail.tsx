import type { EnvironmentId, LinearTicket, LinearTicketComment } from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { useNowMinute } from "~/hooks/useNowMinute";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { WorkflowsSubheader } from "../../workflows/WorkflowsSubheader";
import { CommentBox, TicketActions, TicketPriorityBadge, TicketStateChip } from "./TicketParts";

/**
 * A priority opened in place: the whole ticket, its comments oldest first, and
 * a comment box pinned to the bottom. Opening it marks the comments seen.
 */
export function PriorityDetail(props: {
  environmentId: EnvironmentId;
  /** The list's copy, shown until the full ticket arrives. */
  ticket: LinearTicket;
  canComment: boolean;
  checkingDone: boolean;
  onBack: () => void;
  onDone: () => void;
  onSeen: (latestOthersCommentAt: string | null) => void;
  onCommented: () => void;
}) {
  const detail = useEnvironmentQuery(
    linearEnvironment.ticketDetail({
      environmentId: props.environmentId,
      input: { identifier: props.ticket.identifier },
    }),
  );
  useNowMinute();
  const full = detail.data;
  const ticket = full ?? props.ticket;
  const { onSeen } = props;
  const latestSeen = full?.latestOthersCommentAt;

  useEffect(() => {
    if (latestSeen !== undefined) onSeen(latestSeen);
  }, [latestSeen, onSeen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          {ticket.identifier}
        </span>
        {ticket.url.length > 0 ? (
          <Button
            size="xs"
            variant="ghost-muted"
            render={<a href={ticket.url} target="_blank" rel="noreferrer noopener" />}
          >
            Open in Linear
            <ExternalLinkIcon />
          </Button>
        ) : null}
      </WorkflowsSubheader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 border-b border-border/60 px-4 pt-3 pb-2">
          <h2 className="text-base leading-snug font-semibold text-foreground">{ticket.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <TicketStateChip ticket={ticket} />
            <TicketPriorityBadge ticket={ticket} />
            {full?.assigneeName ? <span>· {full.assigneeName}</span> : null}
          </div>
          <TicketActions ticket={ticket} checkingDone={props.checkingDone} onDone={props.onDone} />
        </div>
        <div className="px-4 py-3">
          {full === null ? (
            <p className="text-xs text-muted-foreground">{detail.error ?? "Loading the ticket…"}</p>
          ) : full.description.trim().length > 0 ? (
            <ChatMarkdown
              text={full.description}
              cwd={undefined}
              environmentId={props.environmentId}
            />
          ) : (
            <p className="text-xs text-muted-foreground italic">No description.</p>
          )}
        </div>
        {full !== null ? (
          <section className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
            <h3 className="text-xs font-medium text-muted-foreground">
              {full.comments.length === 0
                ? "No comments yet"
                : `${full.comments.length} comment${full.comments.length === 1 ? "" : "s"}`}
            </h3>
            <ol className="flex flex-col gap-2">
              {full.comments.map((comment) => (
                <TicketCommentItem
                  key={comment.id}
                  environmentId={props.environmentId}
                  comment={comment}
                />
              ))}
            </ol>
          </section>
        ) : null}
      </div>
      {props.canComment ? (
        <div className="shrink-0 border-t border-border/60 p-2">
          <CommentBox
            environmentId={props.environmentId}
            ticket={ticket}
            onSent={() => {
              detail.refresh();
              props.onCommented();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function TicketCommentItem(props: { environmentId: EnvironmentId; comment: LinearTicketComment }) {
  const { comment } = props;
  return (
    <li
      className={
        comment.isViewer
          ? "rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
          : "rounded-lg border border-border/60 bg-card px-3 py-2"
      }
    >
      <div className="mb-1 flex items-center gap-2">
        {comment.authorAvatarUrl !== null ? (
          <img src={comment.authorAvatarUrl} alt="" className="size-4 rounded-full" />
        ) : null}
        <span className="truncate text-xs font-medium text-foreground">{comment.authorName}</span>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {formatRelativeTimeLabel(comment.createdAt)}
        </span>
      </div>
      <ChatMarkdown text={comment.body} cwd={undefined} environmentId={props.environmentId} />
    </li>
  );
}
