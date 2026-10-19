import type { Note, NoteCategory, NoteCategoryColor, NoteCategoryId } from "@t3tools/contracts";
import {
  NotebookPenIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { NoteCategoryDot, NoteCategorySubmenu } from "./NoteCategoryMenu";
import { NOTE_CATEGORY_COLOR_CLASSES, UNCATEGORISED_CARD_CLASS } from "./noteCategoryColors";
import {
  groupNotesByCategory,
  noteDisplayTitle,
  notePreviewLine,
  noteTaskProgress,
  type NoteGroup,
} from "./notesPanel.logic";

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

/** Where a right-click landed, so one menu per list can open at the pointer. */
type PointerMenu<T> = { target: T; x: number; y: number };

function usePointerAnchor<T>(menu: PointerMenu<T> | null) {
  return useMemo(
    () => (menu ? { getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) } : undefined),
    [menu],
  );
}

function NoteRow(props: {
  note: Note;
  category: NoteCategory | null;
  onOpen: () => void;
  onContextMenu: (position: { x: number; y: number }) => void;
}) {
  const { note } = props;
  const preview = notePreviewLine(note.body);
  const progress = noteTaskProgress(note.body);
  const updated = formatRelativeTimeLabel(note.updatedAt);
  const tint =
    props.category === null
      ? UNCATEGORISED_CARD_CLASS
      : NOTE_CATEGORY_COLOR_CLASSES[props.category.color].card;
  return (
    <li>
      <button
        type="button"
        onClick={props.onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu({ x: event.clientX, y: event.clientY });
        }}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
          tint,
        )}
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
        {preview ? <span className="truncate text-xs text-foreground/80">{preview}</span> : null}
        <span className="truncate text-xs text-muted-foreground">
          {note.createdByThreadId !== null ? "Agent · " : ""}
          {updated}
        </span>
      </button>
    </li>
  );
}

/**
 * Every note on the server, folded under its category, newest edit first
 * within each group. The header creates one by hand or by agent; a right-click
 * on a note files it, and a right-click on a group header manages the category.
 */
export function NotesListView(props: {
  notes: ReadonlyArray<Note> | null;
  categories: ReadonlyArray<NoteCategory>;
  collapsedGroups: ReadonlyArray<string>;
  error: string | null;
  canWrite: boolean;
  onOpen: (note: Note) => void;
  onCreate: () => void;
  onCreateWithAgent: () => void;
  onToggleGroup: (groupKey: string) => void;
  onSetCategory: (note: Note, categoryId: NoteCategoryId | null) => void;
  onCreateCategory: (name: string, assignTo: Note | null) => void;
  onRenameCategory: (category: NoteCategory) => void;
  onRecolorCategory: (category: NoteCategory, color: NoteCategoryColor) => void;
  onDeleteCategory: (category: NoteCategory) => void;
  onDelete: (note: Note) => void;
}) {
  const notes = props.notes ?? [];
  const groups = groupNotesByCategory(notes, props.categories);
  const [noteMenu, setNoteMenu] = useState<PointerMenu<Note> | null>(null);
  const [groupMenu, setGroupMenu] = useState<PointerMenu<NoteCategory> | null>(null);
  const noteAnchor = usePointerAnchor(noteMenu);
  const groupAnchor = usePointerAnchor(groupMenu);
  // The menu's note is looked up live so a rename elsewhere does not show stale text.
  const menuNote = noteMenu ? (notes.find((note) => note.id === noteMenu.target.id) ?? null) : null;
  const menuCategory = groupMenu
    ? (props.categories.find((category) => category.id === groupMenu.target.id) ?? null)
    : null;

  const renderGroup = (group: NoteGroup) => {
    const collapsed = props.collapsedGroups.includes(group.key);
    return (
      <div key={group.key} className="flex flex-col gap-1.5">
        <CollapsibleSectionHeader
          variant="panel"
          expanded={!collapsed}
          onClick={() => props.onToggleGroup(group.key)}
          onContextMenu={
            group.category === null
              ? undefined
              : (event) => {
                  event.preventDefault();
                  setGroupMenu({ target: group.category!, x: event.clientX, y: event.clientY });
                }
          }
          accessory={
            collapsed ? (
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {group.notes.length}
              </span>
            ) : null
          }
        >
          <span className="flex items-center gap-1.5">
            {group.category !== null ? <NoteCategoryDot color={group.category.color} /> : null}
            <span className="truncate">{group.category?.name ?? "Uncategorised"}</span>
          </span>
        </CollapsibleSectionHeader>
        {collapsed ? null : (
          <ul className="flex flex-col gap-1.5">
            {group.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                category={group.category}
                onOpen={() => props.onOpen(note)}
                onContextMenu={(position) => setNoteMenu({ target: note, ...position })}
              />
            ))}
          </ul>
        )}
      </div>
    );
  };

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
      {props.notes !== null && props.notes.length === 0 && props.categories.length === 0 ? (
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
          {props.categories.length === 0 ? (
            // No categories yet: the plain list, no headers to click through.
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  category={null}
                  onOpen={() => props.onOpen(note)}
                  onContextMenu={(position) => setNoteMenu({ target: note, ...position })}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-2">{groups.map(renderGroup)}</div>
          )}
        </div>
      )}
      <Menu
        open={menuNote !== null}
        onOpenChange={(open) => {
          if (!open) setNoteMenu(null);
        }}
      >
        <MenuPopup anchor={noteAnchor} align="start" side="bottom" sideOffset={0} className="w-52">
          {menuNote !== null ? (
            <>
              <MenuItem onClick={() => props.onOpen(menuNote)}>
                <PencilIcon />
                Open
              </MenuItem>
              <NoteCategorySubmenu
                categories={props.categories}
                value={menuNote.categoryId}
                disabled={!props.canWrite}
                onSelect={(categoryId) => props.onSetCategory(menuNote, categoryId)}
                onCreate={(name) => props.onCreateCategory(name, menuNote)}
              />
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={!props.canWrite}
                onClick={() => props.onDelete(menuNote)}
              >
                <Trash2Icon />
                Delete
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      <Menu
        open={menuCategory !== null}
        onOpenChange={(open) => {
          if (!open) setGroupMenu(null);
        }}
      >
        <MenuPopup anchor={groupAnchor} align="start" side="bottom" sideOffset={0} className="w-52">
          {menuCategory !== null ? (
            <>
              <MenuItem
                disabled={!props.canWrite}
                onClick={() => props.onRenameCategory(menuCategory)}
              >
                <PencilIcon />
                Rename…
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger disabled={!props.canWrite}>
                  <PaletteIcon />
                  <span className="flex-1">Colour</span>
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={menuCategory.color}
                    onValueChange={(color) =>
                      props.onRecolorCategory(menuCategory, color as NoteCategoryColor)
                    }
                  >
                    {(
                      Object.keys(NOTE_CATEGORY_COLOR_CLASSES) as ReadonlyArray<NoteCategoryColor>
                    ).map((color) => (
                      <MenuRadioItem key={color} value={color}>
                        <span className="flex min-w-0 items-center gap-2">
                          <NoteCategoryDot color={color} />
                          {NOTE_CATEGORY_COLOR_CLASSES[color].label}
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={!props.canWrite}
                onClick={() => props.onDeleteCategory(menuCategory)}
              >
                <Trash2Icon />
                Delete category
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </div>
  );
}
