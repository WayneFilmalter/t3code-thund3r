import type { Note, NoteId, ThreadId } from "@t3tools/contracts";

/** One `notes` table row, as SQLite returns it. */
export interface NoteRow {
  readonly note_id: string;
  readonly title: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by_thread_id: string | null;
}

export const UNTITLED_NOTE_TITLE = "Untitled note";

/** A stored title: trimmed, never blank. */
export function normalizeNoteTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : UNTITLED_NOTE_TITLE;
}

export function noteFromRow(row: NoteRow): Note {
  return {
    id: row.note_id as NoteId,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByThreadId: (row.created_by_thread_id as ThreadId | null) ?? null,
  };
}
