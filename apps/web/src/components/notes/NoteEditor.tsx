import type { Note } from "@t3tools/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { NoteTiptapEditor } from "./NoteTiptapEditor";
import type { NoteDraft } from "./notesPanelStore";

/**
 * The form a note is written in: a title and a rich body, saved explicitly.
 * The draft lives in the panel store, so the words survive the tab closing
 * and reopening while a meeting is still going.
 */
export function NoteEditor(props: {
  note: Note | null;
  draft: NoteDraft;
  canWrite: boolean;
  saving: boolean;
  onDraftChange: (draft: NoteDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { draft, onDraftChange } = props;
  const titleRef = useRef<HTMLInputElement>(null);
  const isNew = props.note === null;
  useEffect(() => {
    if (isNew && draft.title.length === 0) titleRef.current?.focus();
  }, [isNew, draft.title.length]);

  const empty = draft.title.trim().length === 0 && draft.body.trim().length === 0;
  const saveDisabled = !props.canWrite || props.saving || empty;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!saveDisabled && !event.repeat) props.onSave();
          return;
        }
        if (event.key !== "Escape" || props.saving) return;
        event.preventDefault();
        event.stopPropagation();
        props.onCancel();
      }}
    >
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onCancel}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {isNew ? "New note" : "Edit note"}
        </span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={saveDisabled}
          onClick={props.onSave}
        >
          {props.saving ? "Saving…" : "Save"}
        </Button>
      </WorkflowsSubheader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <Input
          ref={titleRef}
          aria-label="Note title"
          placeholder="Title"
          value={draft.title}
          disabled={props.saving}
          maxLength={200}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
        />
        <NoteTiptapEditor
          initialValue={draft.body}
          autoFocus={!isNew || draft.title.length > 0}
          disabled={props.saving}
          onChange={(body) => onDraftChange({ ...draft, body })}
        />
        {!props.canWrite ? (
          <p className="text-xs text-muted-foreground">
            This connection cannot write notes on this server.
          </p>
        ) : null}
      </div>
    </div>
  );
}
