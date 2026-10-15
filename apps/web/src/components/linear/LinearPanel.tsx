import {
  LINEAR_ISSUE_STATUSES,
  type EnvironmentId,
  type PullRequestListInput,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ListTodo, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useProject } from "~/state/entities";
import { usePullRequestList, type EnvironmentQueryTarget } from "~/state/pullRequests";
import { usePaginatedBranches } from "~/state/queries";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { LinearSection } from "./LinearSection";
import { selectLinearFetchRevision, useLinearPanelStore } from "./linearPanelStore";
import { EMPTY_LINEAR_GIT_INDEX, buildLinearGitIndex } from "./linearPanel.logic";

/** Enough pages to cover a team's branches without walking a huge repo's whole ref list. */
const MAX_BRANCH_REFS = 2000;

/**
 * Git's view of the team's branches: every ref whose name carries the team key, local or
 * remote, plus the project's pull requests. Both are read once per panel and shared by all
 * sections, so a card's icon costs nothing extra per issue.
 */
function useLinearGitIndex(props: {
  environmentId: EnvironmentId;
  projectRef: ScopedProjectRef | null;
  teamKey: string;
}) {
  const project = useProject(props.projectRef);
  const cwd = project?.workspaceRoot ?? null;
  const branches = usePaginatedBranches({
    environmentId: cwd === null ? null : props.environmentId,
    cwd,
    query: `${props.teamKey.toLowerCase()}-`,
  });
  const { loadNext } = branches;
  const hasMore = branches.data?.nextCursor != null;
  useEffect(() => {
    if (hasMore && !branches.isFetchingNextPage && branches.refs.length < MAX_BRANCH_REFS) {
      loadNext();
    }
  }, [branches.isFetchingNextPage, branches.refs.length, hasMore, loadNext]);

  const projectId = props.projectRef?.projectId;
  const pullRequestTargets = useMemo(
    (): ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>> =>
      projectId === undefined
        ? []
        : [{ environmentId: props.environmentId, input: { state: "all", projectId, limit: 500 } }],
    [projectId, props.environmentId],
  );
  const pullRequests = usePullRequestList(pullRequestTargets);
  const entries = pullRequests.data?.entries;

  return useMemo(
    () =>
      branches.refs.length === 0 && (entries === undefined || entries.length === 0)
        ? EMPTY_LINEAR_GIT_INDEX
        : buildLinearGitIndex(branches.refs, entries ?? []),
    [branches.refs, entries],
  );
}

function LinearSubheader(props: { onFetchAll?: (() => void) | undefined }) {
  return (
    <WorkflowsSubheader>
      <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
        Linear
      </span>
      {props.onFetchAll ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Fetch every status"
                onClick={props.onFetchAll}
              />
            }
          >
            <RefreshCwIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>
            <p>Fetch every status</p>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </WorkflowsSubheader>
  );
}

function LinearSetupPrompt(props: { title: string; description: string }) {
  const navigate = useNavigate();
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <ListTodo className="size-4.5 text-muted-foreground" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={() => void navigate({ to: "/settings/integrations" })}>
          <SettingsIcon className="size-3.5" />
          Open integrations settings
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function LinearPanelBody(props: {
  threadRef: ScopedThreadRef | null;
  projectRef: ScopedProjectRef | null;
  environmentId: EnvironmentId;
}) {
  const { environmentId } = props;
  const linear = useEnvironmentSettings(environmentId, (settings) => settings.linear);
  const gitIndex = useLinearGitIndex({
    environmentId,
    projectRef: props.projectRef,
    teamKey: linear.teamKey,
  });
  const openLink = useOpenLink(props.threadRef);
  const fetchRevision = useLinearPanelStore((state) =>
    selectLinearFetchRevision(state.byEnvironment, environmentId),
  );
  const fetchAll = useLinearPanelStore((state) => state.fetchAll);
  const onOpen = useCallback(
    (url: string) => {
      openLink(url).catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not open Linear",
          description: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [openLink],
  );

  const configured = linear.apiKey.length > 0 && linear.teamKey.length > 0;
  if (!configured) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <LinearSubheader />
        <LinearSetupPrompt
          title="Connect Linear"
          description={
            linear.apiKey.length === 0
              ? "Save a Linear API key and the team key whose issues you want to see. The server reads Linear directly; no agent is involved."
              : "Set the Linear team key whose issues you want to see."
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LinearSubheader onFetchAll={() => fetchAll(environmentId)} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {LINEAR_ISSUE_STATUSES.map((status) => (
          <section key={status.id} aria-label={status.label}>
            <LinearSection
              status={status.id}
              label={status.label}
              environmentId={environmentId}
              fetchRevision={fetchRevision}
              gitIndex={gitIndex}
              onOpen={onOpen}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The right panel's Linear tab: the configured team's issues, one folded
 * section per workflow state. Every fetch is a plain server request to
 * Linear's MCP endpoint, so reading issues spends no agent tokens.
 */
export function LinearPanel(props: {
  threadRef: ScopedThreadRef | null;
  projectRef: ScopedProjectRef | null;
  environmentId: EnvironmentId | null;
}) {
  if (props.environmentId === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <LinearSubheader />
        <Empty>
          <EmptyMedia variant="icon">
            <ListTodo className="size-4.5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No environment</EmptyTitle>
            <EmptyDescription>
              Open a thread to read its environment's Linear issues.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  return (
    <LinearPanelBody
      threadRef={props.threadRef}
      projectRef={props.projectRef}
      environmentId={props.environmentId}
    />
  );
}
