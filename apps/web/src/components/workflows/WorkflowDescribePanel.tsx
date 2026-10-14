import type { ScopedProjectRef } from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { draftWorkflowWithAgent } from "~/workflows/workflowAuthoring";
import { getWorkflowRunnerPorts } from "~/workflows/workflowRunnerSingleton";
import type { WorkflowDefinitionInput, WorkflowInstanceThread } from "~/workflowsStore";

import { WorkflowsSubheader } from "./WorkflowsSubheader";

type DraftState =
  | { kind: "idle" }
  | { kind: "drafting"; thread: WorkflowInstanceThread | null }
  | { kind: "failed"; error: string; thread: WorkflowInstanceThread | null };

/**
 * "Describe it to an agent": a description box, one drafting turn on a fresh thread, and the
 * builder opens with the result. The wait lives in this component, so leaving the panel drops
 * it; the thread keeps running and the description can be sent again.
 */
export function WorkflowDescribePanel(props: {
  projectRef: ScopedProjectRef;
  onBack: () => void;
  onDrafted: (input: WorkflowDefinitionInput) => void;
  onOpenThread: (thread: WorkflowInstanceThread) => void;
}) {
  const [description, setDescription] = useState("");
  const [state, setState] = useState<DraftState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const draft = async () => {
    if (!description.trim() || state.kind === "drafting") return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    let thread: WorkflowInstanceThread | null = null;
    setState({ kind: "drafting", thread: null });
    const result = await draftWorkflowWithAgent(
      getWorkflowRunnerPorts(),
      props.projectRef,
      description,
      abort.signal,
      (started) => {
        thread = started;
        if (!abort.signal.aborted) setState({ kind: "drafting", thread: started });
      },
    );
    if (abort.signal.aborted) return;
    if (result.ok) {
      setState({ kind: "idle" });
      props.onDrafted(result.input);
      return;
    }
    setState({ kind: "failed", error: result.error, thread });
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setState({ kind: "idle" });
  };

  const thread = state.kind === "idle" ? null : state.thread;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          Describe a workflow
        </span>
      </WorkflowsSubheader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <p className="text-xs text-muted-foreground">
          Say what the workflow should do, step by step if you like. An agent drafts it; the builder
          opens with the result for you to review and save.
        </p>
        <Textarea
          value={description}
          rows={8}
          placeholder='e.g. "Find 5 tickets labelled ready-for-agent. For each: plan, implement in a worktree, open a PR, comment on the ticket. Summary at the end."'
          disabled={state.kind === "drafting"}
          aria-label="Workflow description"
          onChange={(event) => setDescription(event.target.value)}
        />
        {state.kind === "failed" ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            {state.error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          {state.kind === "drafting" ? (
            <>
              <Spinner className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                An agent is drafting your workflow…
              </span>
              <Button type="button" variant="ghost" size="xs" onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="xs"
                disabled={!description.trim()}
                onClick={() => void draft()}
              >
                <SparklesIcon />
                {state.kind === "failed" ? "Try again" : "Draft with agent"}
              </Button>
              <span className="flex-1" />
            </>
          )}
          {thread ? (
            <Button
              type="button"
              variant="ghost-muted"
              size="xs"
              onClick={() => props.onOpenThread(thread)}
            >
              <ExternalLinkIcon />
              Open thread
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
