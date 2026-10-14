import type { LinearIssue } from "@t3tools/contracts";
import { Check, Copy, ExternalLink } from "lucide";
import { GitBranchIcon } from "lucide-react";
import { useRef } from "react";

import { MorphIcon } from "~/components/MorphIcon";
import { PULL_REQUEST_STATE_PRESENTATION } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "~/components/ui/anchoredCopyToast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

import { PRIORITY_BADGE_VARIANTS, PRIORITY_TONES } from "./linearTones";
import { PRIORITY_LABELS, estimateLabel, type LinearGitPresence } from "./linearPanel.logic";

/** Top-right of the card: what git knows about the issue's branch. Nothing when nothing. */
function GitPresenceIcon({ presence }: { presence: LinearGitPresence }) {
  if (presence === "none") return null;
  if (presence === "branch") {
    return <GitBranchIcon aria-label="Branch exists" className="size-3 text-muted-foreground" />;
  }
  const state = PULL_REQUEST_STATE_PRESENTATION[presence];
  return (
    <state.Icon
      aria-label={`Pull request ${state.label.toLowerCase()}`}
      className={cn("size-3", state.toneClassName)}
    />
  );
}

function BranchCopyButton({ issue }: { issue: LinearIssue }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  const branch = issue.branchName;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            type="button"
            size="xs"
            variant="ghost-muted"
            aria-label={`Copy branch name for ${issue.identifier}`}
            disabled={branch === null}
            onClick={() => {
              if (branch !== null) copyToClipboard(branch, undefined);
            }}
          />
        }
      >
        <MorphIcon
          className={cn("size-3", isCopied && "text-success")}
          icon={isCopied ? Check : Copy}
        />
        Branch
      </TooltipTrigger>
      <TooltipPopup>
        <p>{branch === null ? "Linear returned no branch name" : isCopied ? "Copied" : branch}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * One Linear issue in the workflow card shape. The border and dot follow the
 * issue's priority rather than its section, so the urgent ones stand out
 * wherever they sit. Footer: priority, estimate, copy the git branch, open in Linear.
 */
export function LinearIssueBubble(props: {
  issue: LinearIssue;
  gitPresence: LinearGitPresence;
  onOpen: (url: string) => void;
}) {
  const { issue } = props;
  const tone = PRIORITY_TONES[issue.priority];
  const estimate = estimateLabel(issue.estimate);
  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-lg border bg-card/40 px-3 py-2", tone.bubble)}
    >
      <div className="flex items-start gap-2">
        {tone.dot ? (
          <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone.dot)} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{issue.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {issue.identifier}
            {issue.stateName ? ` · ${issue.stateName}` : ""}
          </span>
        </div>
        <span className="mt-1 flex shrink-0 items-center">
          <GitPresenceIcon presence={props.gitPresence} />
        </span>
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <Badge variant={PRIORITY_BADGE_VARIANTS[issue.priority]} size="sm" className="shrink-0">
          {PRIORITY_LABELS[issue.priority]}
        </Badge>
        {estimate ? (
          <Badge variant="outline" size="sm" className="shrink-0">
            {estimate}
          </Badge>
        ) : null}
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-1">
          <BranchCopyButton issue={issue} />
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label={`View ${issue.identifier} in Linear`}
            disabled={issue.url.length === 0}
            onClick={() => props.onOpen(issue.url)}
          >
            <MorphIcon className="size-3" icon={ExternalLink} />
            View
          </Button>
        </span>
      </div>
    </div>
  );
}
