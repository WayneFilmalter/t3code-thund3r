import type {
  EnvironmentId,
  Note,
  NoteCategory,
  NoteCategoryId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type { MouseEvent } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { NoteCategorySubmenu } from "./NoteCategoryMenu";
import { noteDisplayTitle } from "./notesPanel.logic";

export type NoteMenuAction =
  | { kind: "edit" }
  | { kind: "copy" }
  | { kind: "agent" }
  | { kind: "delete" }
  | { kind: "category"; categoryId: NoteCategoryId | null }
  | { kind: "create-category"; name: string };

/**
 * A tap on the rendered body opens the editor, unless it landed on something
 * that already does a job (a link, a checkbox, a copy button) or the user was
 * selecting text to copy. Keyboard users keep the menu's Edit item.
 */
export function shouldEditOnBodyClick(
  target: Element | null,
  selectionCollapsed: boolean,
): boolean {
  if (!selectionCollapsed) return false;
  if (target === null) return true;
  return target.closest("a, button, input, label, [data-no-edit]") === null;
}

/**
 * One note, rendered. Task-list checkboxes are live: ticking one rewrites the
 * stored markdown, so the panel reads the latest body from the live list and
 * passes it here untouched (the toggle offsets index that exact string).
 */
export function NoteView(props: {
  note: Note;
  categories: ReadonlyArray<NoteCategory>;
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
  const category = props.categories.find((entry) => entry.id === note.categoryId) ?? null;
  const onBodyClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!props.canWrite) return;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    const collapsed = selection === null || selection.isCollapsed;
    const target = event.target instanceof Element ? event.target : null;
    if (shouldEditOnBodyClick(target, collapsed)) props.onMenuAction({ kind: "edit" });
  };
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
          <MenuPopup align="end" className="w-52">
            <MenuItem
              disabled={!props.canWrite}
              onClick={() => props.onMenuAction({ kind: "edit" })}
            >
              <PencilIcon />
              Edit
            </MenuItem>
            <NoteCategorySubmenu
              categories={props.categories}
              value={note.categoryId}
              disabled={!props.canWrite}
              onSelect={(categoryId) => props.onMenuAction({ kind: "category", categoryId })}
              onCreate={(name) => props.onMenuAction({ kind: "create-category", name })}
            />
            <MenuItem onClick={() => props.onMenuAction({ kind: "copy" })}>
              <CopyIcon />
              Copy contents
            </MenuItem>
            <MenuItem
              disabled={!props.canWrite}
              onClick={() => props.onMenuAction({ kind: "agent" })}
            >
              <SparklesIcon />
              Continue with agent
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              disabled={!props.canWrite}
              onClick={() => props.onMenuAction({ kind: "delete" })}
            >
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </WorkflowsSubheader>
      {/* The whole body is a tap target for editing; the handler filters out interactive children. */}
      <div
        className={
          props.canWrite
            ? "min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-3"
            : "min-h-0 flex-1 overflow-y-auto px-4 py-3"
        }
        onClick={onBodyClick}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {category !== null ? `${category.name} · ` : ""}
          {note.createdByThreadId !== null ? "Written by an agent · " : ""}
          {updated ? `Updated ${updated}` : ""}
        </p>
        {note.body.trim().length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {props.canWrite
              ? "This note has no body yet. Tap to write one."
              : "This note has no body yet."}
          </p>
        ) : (
          // The editor saves one newline per paragraph, like the chat composer, so
          // single newlines are hard breaks here as they are in chat.
          <ChatMarkdown
            text={note.body}
            cwd={undefined}
            environmentId={props.environmentId}
            threadRef={props.threadRef ?? undefined}
            lineBreaks
            onTaskListChange={props.canWrite && !props.pending ? props.onTaskListChange : undefined}
          />
        )}
      </div>
    </div>
  );
}
