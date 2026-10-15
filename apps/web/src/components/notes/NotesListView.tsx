import type { Note } from "@t3tools/contracts";
import { NotebookPenIcon, PlusIcon, SparklesIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { noteDisplayTitle, notePreviewLine, noteTaskProgress } from "./notesPanel.logic";

function HeaderButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
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

/** Every note on the server, newest edit first; the header creates one by hand or by agent. */
export function NotesListView(props: {
  notes: ReadonlyArray<Note> | null;
  error: string | null;
  canWrite: boolean;
  onOpen: (note: Note) => void;
  onCreate: () => void;
  onCreateWithAgent: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          Notes
        </span>
        <HeaderButton
          label="Draft a note with an agent"
          disabled={!props.canWrite}
          onClick={props.onCreateWithAgent}
        >
          <SparklesIcon className="size-3.5" />
        </HeaderButton>
        <HeaderButton label="New note" disabled={!props.canWrite} onClick={props.onCreate}>
          <PlusIcon className="size-3.5" />
        </HeaderButton>
      </WorkflowsSubheader>
      {props.error !== null ? (
        <p className="m-3 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
      {props.notes !== null && props.notes.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <NotebookPenIcon className="size-4.5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No notes yet</EmptyTitle>
            <EmptyDescription>
              Keep meeting notes and to-do lists here. They stay on this server, outside any
              project, and agents can write them for you.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <ul className="flex flex-col gap-1.5">
            {(props.notes ?? []).map((note) => {
              const preview = notePreviewLine(note.body);
              const progress = noteTaskProgress(note.body);
              const updated = formatRelativeTimeLabel(note.updatedAt);
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => props.onOpen(note)}
                    className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {noteDisplayTitle(note)}
                      </span>
                      {progress ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {progress.done}/{progress.total}
                        </span>
                      ) : null}
                    </span>
                    {preview ? (
                      <span className="truncate text-xs text-foreground/80">{preview}</span>
                    ) : null}
                    <span className="truncate text-xs text-muted-foreground">
                      {note.createdByThreadId !== null ? "Agent · " : ""}
                      {updated}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
