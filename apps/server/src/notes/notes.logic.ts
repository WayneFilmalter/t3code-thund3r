import type {
  Note,
  NoteCategory,
  NoteCategoryColor,
  NoteCategoryId,
  NoteId,
  ThreadId,
} from "@t3tools/contracts";

/** One `notes` table row, as SQLite returns it. */
export interface NoteRow {
  readonly note_id: string;
  readonly title: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by_thread_id: string | null;
  readonly category_id: string | null;
}

/** One `note_categories` table row. */
export interface NoteCategoryRow {
  readonly category_id: string;
  readonly name: string;
  readonly color: string;
  readonly created_at: string;
}

export const UNTITLED_NOTE_TITLE = "Untitled note";
export const UNTITLED_CATEGORY_NAME = "Untitled category";

/** A stored title: trimmed, never blank. */
export function normalizeNoteTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : UNTITLED_NOTE_TITLE;
}

/** A stored category name: trimmed, never blank. */
export function normalizeNoteCategoryName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : UNTITLED_CATEGORY_NAME;
}

export function noteFromRow(row: NoteRow): Note {
  return {
    id: row.note_id as NoteId,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByThreadId: (row.created_by_thread_id as ThreadId | null) ?? null,
    categoryId: (row.category_id as NoteCategoryId | null) ?? null,
  };
}

export function noteCategoryFromRow(row: NoteCategoryRow): NoteCategory {
  return {
    id: row.category_id as NoteCategoryId,
    name: row.name,
    color: row.color as NoteCategoryColor,
    createdAt: row.created_at,
  };
}
