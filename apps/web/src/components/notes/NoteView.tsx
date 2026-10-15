import type { EnvironmentId, Note, ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { noteDisplayTitle } from "./notesPanel.logic";

export type NoteMenuAction = "edit" | "copy" | "agent" | "delete";

/**
 * One note, rendered. Task-list checkboxes are live: ticking one rewrites the
 * stored markdown, so the panel reads the latest body from the live list and
 * passes it here untouched (the toggle offsets index that exact string).
 */
export function NoteView(props: {
  note: Note;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  canWrite: boolean;
  /** An update is in flight; checkbox toggles wait so two quick clicks cannot write a stale body. */
  pending: boolean;
  onBack: () => void;
  onMenuAction: (action: NoteMenuAction) => void;
  onTaskListChange: (input: { markerOffset: number; checked: boolean }) => void;
}) {
  const { note } = props;
  const updated = formatRelativeTimeLabel(note.updatedAt);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {noteDisplayTitle(note)}
        </span>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Note actions"
              />
            }
          >
            <MoreHorizontalIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" className="w-48">
            <MenuItem disabled={!props.canWrite} onClick={() => props.onMenuAction("edit")}>
              <PencilIcon />
              Edit
            </MenuItem>
            <MenuItem onClick={() => props.onMenuAction("copy")}>
              <CopyIcon />
              Copy contents
            </MenuItem>
            <MenuItem disabled={!props.canWrite} onClick={() => props.onMenuAction("agent")}>
              <SparklesIcon />
              Continue with agent
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              disabled={!props.canWrite}
              onClick={() => props.onMenuAction("delete")}
            >
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </WorkflowsSubheader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 text-xs text-muted-foreground">
          {note.createdByThreadId !== null ? "Written by an agent · " : ""}
          {updated ? `Updated ${updated}` : ""}
        </p>
        {note.body.trim().length === 0 ? (
          <p className="text-sm text-muted-foreground">This note has no body yet.</p>
        ) : (
          <ChatMarkdown
            text={note.body}
            cwd={undefined}
            environmentId={props.environmentId}
            threadRef={props.threadRef ?? undefined}
            onTaskListChange={props.canWrite && !props.pending ? props.onTaskListChange : undefined}
          />
        )}
      </div>
    </div>
  );
}
