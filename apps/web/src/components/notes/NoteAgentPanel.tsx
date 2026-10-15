import type { Note } from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import type { WorkflowInstanceThread } from "~/workflowsStore";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import type { NoteAgentResult } from "./notesAgent";
import { noteDisplayTitle } from "./notesPanel.logic";

type DraftState =
  | { kind: "idle" }
  | { kind: "running"; thread: WorkflowInstanceThread | null }
  | { kind: "failed"; error: string; thread: WorkflowInstanceThread | null };

/**
 * "Draft with agent": a request box and one agent turn on a fresh thread that
 * saves its answer as a note. The wait lives here, so leaving the panel drops
 * it; the thread keeps running and its note still lands on the list.
 */
export function NoteAgentPanel(props: {
  /** The note to extend, or null to write a new one. */
  target: Note | null;
  run: (
    request: string,
    signal: AbortSignal,
    onThread: (thread: WorkflowInstanceThread) => void,
  ) => Promise<NoteAgentResult>;
  onBack: () => void;
  onDone: () => void;
  onOpenThread: (thread: WorkflowInstanceThread) => void;
}) {
  const [request, setRequest] = useState("");
  const [state, setState] = useState<DraftState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    if (!request.trim() || state.kind === "running") return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    let thread: WorkflowInstanceThread | null = null;
    setState({ kind: "running", thread: null });
    const result = await props.run(request, abort.signal, (started) => {
      thread = started;
      if (!abort.signal.aborted) setState({ kind: "running", thread: started });
    });
    if (abort.signal.aborted) return;
    if (result.ok) {
      setState({ kind: "idle" });
      props.onDone();
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
  const extending = props.target !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {extending
            ? `Continue “${noteDisplayTitle(props.target!)}”`
            : "Draft a note with an agent"}
        </span>
      </WorkflowsSubheader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <p className="text-xs text-muted-foreground">
          {extending
            ? "Say what the agent should add or change. It runs on its own thread and rewrites this note when it is done."
            : "Say what to research or write up. An agent runs on its own thread and saves the result here as a note."}
        </p>
        <Textarea
          value={request}
          rows={6}
          placeholder={
            extending
              ? 'e.g. "Add a section comparing the two options with pros and cons."'
              : 'e.g. "Research how the checkpoint system works and list the open questions as tasks."'
          }
          disabled={state.kind === "running"}
          aria-label="Request for the agent"
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void start();
            }
          }}
        />
        {state.kind === "failed" ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            {state.error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          {state.kind === "running" ? (
            <>
              <Spinner className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                An agent is writing your note…
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
                disabled={!request.trim()}
                onClick={() => void start()}
              >
                <SparklesIcon />
                {state.kind === "failed" ? "Try again" : extending ? "Update note" : "Draft note"}
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
