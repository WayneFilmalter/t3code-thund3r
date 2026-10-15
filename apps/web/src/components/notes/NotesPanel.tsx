import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type Note,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { NotebookPenIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { useScratchProject } from "~/hooks/useScratchProject";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { readEnvironmentScope } from "~/state/session";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { getWorkflowRunnerPorts } from "~/workflows/workflowRunnerSingleton";
import type { WorkflowInstanceThread } from "~/workflowsStore";
import { AsyncResult, type Atom } from "effect/reactivity";
import * as Option from "effect/Option";

import { setMarkdownTaskChecked } from "../files/filePreviewMode";
import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { NoteAgentPanel } from "./NoteAgentPanel";
import { NoteEditor } from "./NoteEditor";
import { NoteView, type NoteMenuAction } from "./NoteView";
import { NotesListView } from "./NotesListView";
import { draftNoteWithAgent } from "./notesAgent";
import { findNote, noteWrittenByThread } from "./notesPanel.logic";
import {
  selectNotesPanelState,
  useNotesPanelStore,
  type NoteDraft,
  type NotesPanelMode,
} from "./notesPanelStore";

const EMPTY_INPUT = {};

function NotesPanelBody(props: {
  environmentId: EnvironmentId;
  projectRef: ScopedProjectRef | null;
  threadRef: ScopedThreadRef | null;
  maximized: boolean;
  onSetMaximized: ((maximized: boolean) => void) | undefined;
}) {
  const { environmentId } = props;
  const liveAtom = serverEnvironment.notesLive({ environmentId, input: EMPTY_INPUT });
  const live = useEnvironmentQuery(liveAtom);
  const notes = live.data?.notes ?? null;
  const notesRef = useRef<ReadonlyArray<Note> | null>(null);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const canWrite = useAtomValue(serverEnvironment.createNote.permissionAtom(environmentId));
  const createNote = useAtomCommand(serverEnvironment.createNote, { label: "note" });
  const updateNote = useAtomCommand(serverEnvironment.updateNote, { label: "note" });
  const deleteNote = useAtomCommand(serverEnvironment.deleteNote, { label: "note" });
  // The ref guards re-entry inside async handlers; the state drives the UI.
  const pendingRef = useRef(false);
  const [pending, setPendingState] = useState(false);
  const setPending = (value: boolean) => {
    pendingRef.current = value;
    setPendingState(value);
  };

  const { mode, draft } = useNotesPanelStore((state) =>
    selectNotesPanelState(state.byEnvironment, environmentId),
  );
  const setMode = useCallback(
    (next: NotesPanelMode) => useNotesPanelStore.getState().setMode(environmentId, next),
    [environmentId],
  );
  const setDraft = useCallback(
    (next: NoteDraft | null) => useNotesPanelStore.getState().setDraft(environmentId, next),
    [environmentId],
  );

  const navigate = useNavigate();
  const { openScratchProject } = useScratchProject();

  // Edit mode gets the wide panel; Back restores what the user had.
  const restoreMaximized = useRef<boolean | null>(null);
  const enterWide = (next: NotesPanelMode) => {
    if (restoreMaximized.current === null) restoreMaximized.current = props.maximized;
    props.onSetMaximized?.(true);
    setMode(next);
  };
  const backToList = () => {
    if (restoreMaximized.current !== null) {
      props.onSetMaximized?.(restoreMaximized.current);
      restoreMaximized.current = null;
    }
    setMode({ kind: "list" });
  };

  const viewed = mode.kind === "view" ? findNote(notes ?? [], mode.noteId) : null;
  // A note deleted elsewhere drops the panel back to the list.
  useEffect(() => {
    if (mode.kind === "view" && notes !== null && viewed === null) setMode({ kind: "list" });
  }, [mode.kind, notes, viewed, setMode]);

  const openEditor = (note: Note | null) => {
    const current = draft;
    const keep = current !== null && current.noteId === (note?.id ?? null);
    if (!keep) {
      setDraft({ noteId: note?.id ?? null, title: note?.title ?? "", body: note?.body ?? "" });
    }
    enterWide({ kind: "edit", noteId: note?.id ?? null });
  };

  // Each write re-reads the grant: a button can be stale after a revoke.
  const mayWrite = () => readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);

  const save = async () => {
    if (draft === null || pendingRef.current || !mayWrite()) return;
    setPending(true);
    const result =
      draft.noteId === null
        ? await createNote({ environmentId, input: { title: draft.title, body: draft.body } })
        : await updateNote({
            environmentId,
            input: { id: draft.noteId, title: draft.title, body: draft.body },
          });
    setPending(false);
    if (result._tag !== "Success") return;
    setDraft(null);
    if (restoreMaximized.current !== null) {
      props.onSetMaximized?.(restoreMaximized.current);
      restoreMaximized.current = null;
    }
    setMode({ kind: "view", noteId: result.value.id });
  };

  const cancelEdit = () => {
    const noteId = draft?.noteId ?? null;
    setDraft(null);
    if (noteId !== null) {
      if (restoreMaximized.current !== null) {
        props.onSetMaximized?.(restoreMaximized.current);
        restoreMaximized.current = null;
      }
      setMode({ kind: "view", noteId });
      return;
    }
    backToList();
  };

  const copyNote = async (note: Note) => {
    try {
      await navigator.clipboard.writeText(
        note.title.trim().length > 0 ? `# ${note.title}\n\n${note.body}` : note.body,
      );
      toastManager.add({ type: "success", title: "Note copied" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not copy the note",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const removeNote = async (note: Note) => {
    const confirmed = await requestConfirmDialog(`Delete the note "${note.title}"?`, {
      variant: "destructive",
    });
    if (confirmed === false || !mayWrite()) return;
    const result = await deleteNote({ environmentId, input: { id: note.id } });
    if (result._tag === "Success") setMode({ kind: "list" });
  };

  const handleMenuAction = (note: Note, action: NoteMenuAction) => {
    switch (action) {
      case "edit":
        openEditor(note);
        return;
      case "copy":
        void copyNote(note);
        return;
      case "agent":
        setMode({ kind: "agent", noteId: note.id });
        return;
      case "delete":
        void removeNote(note);
        return;
    }
  };

  const toggleTask = async (note: Note, input: { markerOffset: number; checked: boolean }) => {
    if (pendingRef.current || !mayWrite()) return;
    // Always from the live body: the rendered text and the offsets belong to it.
    const latest = findNote(notesRef.current ?? [], note.id) ?? note;
    const body = setMarkdownTaskChecked(latest.body, input.markerOffset, input.checked);
    if (body === latest.body) return;
    setPending(true);
    await updateNote({ environmentId, input: { id: note.id, body } });
    setPending(false);
  };

  /** Resolves once the live list shows a note from `threadId`, or false after `graceMs`. */
  const awaitNoteWritten = (threadId: ThreadId, graceMs: number) =>
    new Promise<boolean>((resolve) => {
      let finished = false;
      let unsubscribe = () => {};
      const finish = (value: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const check = (result: Atom.Type<typeof liveAtom>) => {
        const current = Option.getOrNull(AsyncResult.value(result));
        if (current && noteWrittenByThread(current.notes, threadId) !== null) finish(true);
      };
      const timer = setTimeout(() => finish(false), graceMs);
      unsubscribe = appAtomRegistry.subscribe(liveAtom, check);
      check(appAtomRegistry.get(liveAtom));
    });

  const runAgent = async (
    target: Note | null,
    request: string,
    signal: AbortSignal,
    onThread: (thread: WorkflowInstanceThread) => void,
  ) => {
    let projectRef = props.projectRef;
    if (projectRef === null) {
      // Notes belong to no project, but an agent needs somewhere to run.
      const scratch = await openScratchProject(environmentId, "Could not start the note agent");
      if (scratch === null) return { ok: false as const, error: "No project to run the agent in." };
      projectRef = scopeProjectRef(scratch.environmentId, scratch.id);
    }
    return draftNoteWithAgent(
      getWorkflowRunnerPorts(),
      projectRef,
      request,
      target,
      signal,
      onThread,
      {
        awaitNoteWritten,
        createNote: async (title, body) => {
          const result = await createNote({ environmentId, input: { title, body } });
          if (result._tag !== "Success") {
            toastManager.add({
              type: "error",
              title: "Could not save the agent's note",
              description: String(squashAtomCommandFailure(result)),
            });
            return false;
          }
          return true;
        },
      },
    );
  };

  const openThread = (thread: WorkflowInstanceThread) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.threadId },
    });
  };

  if (mode.kind === "edit" && draft !== null) {
    return (
      <NoteEditor
        key={draft.noteId ?? "new"}
        note={findNote(notes ?? [], draft.noteId)}
        draft={draft}
        canWrite={canWrite}
        saving={pending}
        onDraftChange={setDraft}
        onSave={() => void save()}
        onCancel={cancelEdit}
      />
    );
  }
  if (mode.kind === "agent") {
    const target = findNote(notes ?? [], mode.noteId);
    return (
      <NoteAgentPanel
        key={mode.noteId ?? "new"}
        target={target}
        run={(request, signal, onThread) => runAgent(target, request, signal, onThread)}
        onBack={() =>
          setMode(target === null ? { kind: "list" } : { kind: "view", noteId: target.id })
        }
        onDone={() =>
          setMode(target === null ? { kind: "list" } : { kind: "view", noteId: target.id })
        }
        onOpenThread={openThread}
      />
    );
  }
  if (mode.kind === "view" && viewed !== null) {
    return (
      <NoteView
        note={viewed}
        environmentId={environmentId}
        threadRef={props.threadRef}
        canWrite={canWrite}
        pending={pending}
        onBack={() => setMode({ kind: "list" })}
        onMenuAction={(action) => handleMenuAction(viewed, action)}
        onTaskListChange={(input) => void toggleTask(viewed, input)}
      />
    );
  }
  return (
    <NotesListView
      notes={notes}
      error={live.error}
      canWrite={canWrite}
      onOpen={(note) => setMode({ kind: "view", noteId: note.id })}
      onCreate={() => openEditor(null)}
      onCreateWithAgent={() => setMode({ kind: "agent", noteId: null })}
    />
  );
}

/**
 * The right panel's Notes tab: the server's notes, a list that opens into a
 * rendered note, a rich editor, and an agent that writes notes on request.
 * Notes belong to the environment, not to the thread the panel sits beside.
 */
export function NotesPanel(props: {
  environmentId: EnvironmentId | null;
  projectRef: ScopedProjectRef | null;
  threadRef: ScopedThreadRef | null;
  maximized?: boolean;
  onSetMaximized?: ((maximized: boolean) => void) | undefined;
}) {
  if (props.environmentId === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <WorkflowsSubheader>
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
            Notes
          </span>
        </WorkflowsSubheader>
        <Empty>
          <EmptyMedia variant="icon">
            <NotebookPenIcon className="size-4.5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No server</EmptyTitle>
            <EmptyDescription>Connect to a server to read its notes.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  return (
    <NotesPanelBody
      environmentId={props.environmentId}
      projectRef={props.projectRef}
      threadRef={props.threadRef}
      maximized={props.maximized ?? false}
      onSetMaximized={props.onSetMaximized}
    />
  );
}
