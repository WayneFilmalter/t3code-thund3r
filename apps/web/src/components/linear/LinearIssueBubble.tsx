import type { LinearIssue } from "@t3tools/contracts";
import { Copy, ExternalLink } from "lucide";
import { GitBranchIcon } from "lucide-react";

import { MorphIcon } from "~/components/MorphIcon";
import { PULL_REQUEST_STATE_PRESENTATION } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { LinearCopyButton } from "./LinearCopyButton";
import { PRIORITY_BADGE_VARIANTS, PRIORITY_TONES } from "./linearTones";
import { PRIORITY_LABELS, estimateLabel, type LinearGitPresence } from "./linearPanel.logic";

/**
 * Top-right of the card: what git knows about the issue's branch, in Linear's own
 * convention. One branch glyph whose colour carries the state: grey when the branch
 * exists, green with an open pull request, purple once merged, red when closed.
 * Nothing when nothing.
 */
const GIT_PRESENCE_TONES: Record<
  Exclude<LinearGitPresence, "none">,
  { label: string; className: string }
> = {
  branch: { label: "Branch exists", className: "text-muted-foreground" },
  open: {
    label: "Pull request open",
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

function GitPresenceIcon({ presence }: { presence: LinearGitPresence }) {
  if (presence === "none") return null;
  const tone = GIT_PRESENCE_TONES[presence];
  return (
    <Tooltip>
      <TooltipTrigger
        render={<GitBranchIcon aria-label={tone.label} className={cn("size-3", tone.className)} />}
      />
      <TooltipPopup>
        <p>{tone.label}</p>
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
          <LinearCopyButton
            value={issue.branchName}
            icon={Copy}
            ariaLabel={`Copy branch name for ${issue.identifier}`}
            unavailableHint="Linear returned no branch name"
          >
            Branch
          </LinearCopyButton>
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
