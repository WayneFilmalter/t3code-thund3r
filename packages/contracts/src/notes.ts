import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Notes: free-form markdown the user keeps on a server, outside any project
 * or thread. The right panel's Notes tab reads and edits them, and agents
 * reach the same store through the `t3_note_*` MCP tools. The body is
 * canonical GitHub-flavoured markdown; the rich editor serializes back to it.
 *
 * A note may sit in one category: a named, coloured group the Notes list
 * folds notes under. Categories live beside the notes and travel in the same
 * live list, so one change signal keeps every client's grouping current.
 */
export const NoteId = TrimmedNonEmptyString.pipe(Schema.brand("NoteId"));
export type NoteId = typeof NoteId.Type;

export const NoteCategoryId = TrimmedNonEmptyString.pipe(Schema.brand("NoteCategoryId"));
export type NoteCategoryId = typeof NoteCategoryId.Type;

/** Bounded so the live list stream stays small whatever an agent writes. */
export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_BODY_MAX_LENGTH = 64 * 1024;
export const NOTE_CATEGORY_NAME_MAX_LENGTH = 60;

export const NoteTitle = Schema.String.check(Schema.isMaxLength(NOTE_TITLE_MAX_LENGTH));
export const NoteBody = Schema.String.check(Schema.isMaxLength(NOTE_BODY_MAX_LENGTH));
export const NoteCategoryName = Schema.String.check(
  Schema.isMaxLength(NOTE_CATEGORY_NAME_MAX_LENGTH),
);

/** A fixed palette: clients map each name to a tint that works in light and dark themes. */
export const NOTE_CATEGORY_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export const NoteCategoryColor = Schema.Literals(NOTE_CATEGORY_COLORS);
export type NoteCategoryColor = typeof NoteCategoryColor.Type;

export const NoteCategory = Schema.Struct({
  id: NoteCategoryId,
  name: NoteCategoryName,
  color: NoteCategoryColor,
  createdAt: IsoDateTime,
});
export type NoteCategory = typeof NoteCategory.Type;

export const Note = Schema.Struct({
  id: NoteId,
  title: NoteTitle,
  body: NoteBody,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** The agent thread that wrote the note through MCP, or null for a user-written note. */
  createdByThreadId: Schema.NullOr(ThreadId),
  /** The category the note is filed under, or null for an uncategorised note. */
  categoryId: Schema.NullOr(NoteCategoryId),
});
export type Note = typeof Note.Type;

export const NotesListInput = Schema.Struct({});
export type NotesListInput = typeof NotesListInput.Type;

export const NotesListResult = Schema.Struct({
  /** Newest edit first. */
  notes: Schema.Array(Note),
  /** Every category, by name; a category with no notes is still listed. */
  categories: Schema.Array(NoteCategory),
});
export type NotesListResult = typeof NotesListResult.Type;

export const NoteCreateInput = Schema.Struct({
  title: NoteTitle,
  body: NoteBody,
  createdByThreadId: Schema.optional(ThreadId),
  categoryId: Schema.optional(NoteCategoryId),
});
export type NoteCreateInput = typeof NoteCreateInput.Type;

export const NoteUpdateInput = Schema.Struct({
  id: NoteId,
  title: Schema.optional(NoteTitle),
  body: Schema.optional(NoteBody),
  /** A category id files the note there; null takes it out of its category; omitted keeps it. */
  categoryId: Schema.optional(Schema.NullOr(NoteCategoryId)),
});
export type NoteUpdateInput = typeof NoteUpdateInput.Type;

export const NoteDeleteInput = Schema.Struct({ id: NoteId });
export type NoteDeleteInput = typeof NoteDeleteInput.Type;

export const NoteDeleteResult = Schema.Struct({ id: NoteId });
export type NoteDeleteResult = typeof NoteDeleteResult.Type;

export const NoteCategoryCreateInput = Schema.Struct({
  name: NoteCategoryName,
  color: NoteCategoryColor,
});
export type NoteCategoryCreateInput = typeof NoteCategoryCreateInput.Type;

export const NoteCategoryUpdateInput = Schema.Struct({
  id: NoteCategoryId,
  name: Schema.optional(NoteCategoryName),
  color: Schema.optional(NoteCategoryColor),
});
export type NoteCategoryUpdateInput = typeof NoteCategoryUpdateInput.Type;

/** Deleting a category leaves its notes in place, uncategorised. */
export const NoteCategoryDeleteInput = Schema.Struct({ id: NoteCategoryId });
export type NoteCategoryDeleteInput = typeof NoteCategoryDeleteInput.Type;

export const NoteCategoryDeleteResult = Schema.Struct({ id: NoteCategoryId });
export type NoteCategoryDeleteResult = typeof NoteCategoryDeleteResult.Type;

export class NotesError extends Schema.TaggedError<NotesError>()("NotesError", {
  kind: Schema.Literals(["not-found", "storage"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
