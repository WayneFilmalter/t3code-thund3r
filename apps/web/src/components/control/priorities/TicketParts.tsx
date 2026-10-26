import type { EnvironmentId, LinearTicket } from "@t3tools/contracts";
import { GitBranch, Link } from "lucide";
import { CircleCheckIcon, GitBranchIcon, SendIcon } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { GitHubIcon } from "~/components/Icons";
import { PULL_REQUEST_STATE_PRESENTATION } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { linearEnvironment } from "~/state/linear";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";

import { LinearCopyButton } from "../../linear/LinearCopyButton";
import { PRIORITY_LABELS } from "../../linear/linearPanel.logic";
import { PRIORITY_BADGE_VARIANTS } from "../../linear/linearTones";

/** The ticket number as a bordered chip, the first thing on a ticket so it is easy to find. */
export function TicketIdentifierChip({ identifier }: { identifier: string }) {
  return (
    <span className="inline-flex h-6 w-fit shrink-0 items-center rounded-md border border-foreground/30 bg-background/70 px-2 text-xs font-semibold tracking-wide tabular-nums text-foreground">
      {identifier}
    </span>
  );
}

/** The workflow state in Linear's own colour: a dot and the name on a faint wash of it. */
export function TicketStateChip({
  ticket,
}: {
  ticket: Pick<LinearTicket, "stateName" | "stateColor">;
}) {
  if (ticket.stateName.length === 0) return null;
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium text-foreground/90"
      style={{
        borderColor: `color-mix(in srgb, ${ticket.stateColor} 45%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${ticket.stateColor} 14%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: ticket.stateColor }}
      />
      {ticket.stateName}
    </span>
  );
}

/**
 * The ticket's pull request at a glance, in GitHub's colours: a grey branch
 * without one, green while open (drafts included), purple once merged, red
 * when closed unmerged.
 */
const BRANCH_TONES: Record<
  LinearTicket["pullRequestState"] & string,
  { label: string; className: string }
> = {
  open: {
    label: "Pull request open",
    className: PULL_REQUEST_STATE_PRESENTATION.open.toneClassName,
  },
  draft: {
    label: "Draft pull request open",
    className: PULL_REQUEST_STATE_PRESENTATION.open.toneClassName,
  },
  merged: {
    label: "Pull request merged",
    className: PULL_REQUEST_STATE_PRESENTATION.merged.toneClassName,
  },
  closed: {
    label: "Pull request closed",
    className: PULL_REQUEST_STATE_PRESENTATION.closed.toneClassName,
  },
};

export function TicketBranchIcon({ ticket }: { ticket: Pick<LinearTicket, "pullRequestState"> }) {
  const state = ticket.pullRequestState;
  const tone =
    state === null
      ? { label: "No pull request", className: "text-muted-foreground" }
      : BRANCH_TONES[state];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <GitBranchIcon
            aria-label={tone.label}
            className={cn("size-3.5 shrink-0", tone.className)}
          />
        }
      />
      <TooltipPopup>
        <p>{tone.label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

export function TicketPriorityBadge({ ticket }: { ticket: Pick<LinearTicket, "priority"> }) {
  if (ticket.priority === "none") return null;
  return (
    <Badge variant={PRIORITY_BADGE_VARIANTS[ticket.priority]} size="sm" className="shrink-0">
      {PRIORITY_LABELS[ticket.priority]}
    </Badge>
  );
}

function ActionButton(props: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            aria-pressed={props.pressed}
            disabled={props.disabled}
            onClick={(event) => {
              event.stopPropagation();
              props.onClick();
            }}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{props.label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

/** A plain "Comment" text button that opens the comment box; pressed while it is open. */
export function CommentToggle(props: { allowed: boolean; open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      aria-pressed={props.open}
      disabled={!props.allowed}
      title={props.allowed ? undefined : "This connection cannot comment"}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
    >
      Comment
    </Button>
  );
}

/** The ticket's way out of the list: a green check, top right of the ticket. */
export function DoneButton(props: { checking: boolean; onDone: () => void }) {
  return (
    <ActionButton
      label="Done — remove from priorities"
      disabled={props.checking}
      onClick={props.onDone}
    >
      <CircleCheckIcon className="text-success" />
    </ActionButton>
  );
}

/** Where the ticket leads: its pull request when there is one, its link, its branch. */
export function TicketLinks({ ticket }: { ticket: LinearTicket }) {
  const openLink = useOpenLink(null);
  const pullRequestUrl = ticket.pullRequestUrl;
  return (
    <div className="flex items-center gap-0.5">
      {pullRequestUrl !== null ? (
        <ActionButton
          label="Open pull request"
          onClick={() => {
            openLink(pullRequestUrl).catch((error: unknown) => {
              toastManager.add({
                type: "error",
                title: "Could not open the pull request",
                description: error instanceof Error ? error.message : undefined,
              });
            });
          }}
        >
          <GitHubIcon className="size-3.5" />
        </ActionButton>
      ) : null}
      <LinearCopyButton
        value={ticket.url.length > 0 ? ticket.url : null}
        icon={Link}
        ariaLabel={`Copy link to ${ticket.identifier}`}
        hint="Copy ticket link"
        unavailableHint="Linear returned no link"
      />
      <LinearCopyButton
        value={ticket.branchName}
        icon={GitBranch}
        ariaLabel={`Copy branch name for ${ticket.identifier}`}
        hint={ticket.branchName === null ? undefined : `Copy branch · ${ticket.branchName}`}
        unavailableHint="Linear returned no branch name"
      />
    </div>
  );
}

/** Enter posts, Shift+Enter adds a line, Escape cancels: it closes an inline box or leaves the ticket. */
export function CommentBox(props: {
  environmentId: EnvironmentId;
  ticket: Pick<LinearTicket, "id" | "identifier">;
  autoFocus?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const createComment = useAtomCommand(linearEnvironment.createComment);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await createComment({
        environmentId: props.environmentId,
        input: { issueId: props.ticket.id, body },
      });
      if (result._tag === "Success") {
        setDraft("");
        toastManager.add({ type: "success", title: `Commented on ${props.ticket.identifier}` });
        props.onSent?.();
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && props.onCancel) {
      event.preventDefault();
      props.onCancel();
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Textarea
          size="sm"
          rows={2}
          placeholder={`Comment on ${props.ticket.identifier}…`}
          value={draft}
          disabled={sending}
          autoFocus={props.autoFocus}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <Button
        type="button"
        size="icon-sm"
        aria-label="Post comment"
        disabled={sending || draft.trim().length === 0}
        onClick={() => void send()}
      >
        <SendIcon />
      </Button>
    </div>
  );
}
