import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Notes: free-form markdown the user keeps on a server, outside any project
 * or thread. The right panel's Notes tab reads and edits them, and agents
 * reach the same store through the `t3_note_*` MCP tools. The body is
 * canonical GitHub-flavoured markdown; the rich editor serializes back to it.
 */
export const NoteId = TrimmedNonEmptyString.pipe(Schema.brand("NoteId"));
export type NoteId = typeof NoteId.Type;

/** Bounded so the live list stream stays small whatever an agent writes. */
export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_BODY_MAX_LENGTH = 64 * 1024;

export const NoteTitle = Schema.String.check(Schema.isMaxLength(NOTE_TITLE_MAX_LENGTH));
export const NoteBody = Schema.String.check(Schema.isMaxLength(NOTE_BODY_MAX_LENGTH));

export const Note = Schema.Struct({
  id: NoteId,
  title: NoteTitle,
  body: NoteBody,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** The agent thread that wrote the note through MCP, or null for a user-written note. */
  createdByThreadId: Schema.NullOr(ThreadId),
});
export type Note = typeof Note.Type;

export const NotesListInput = Schema.Struct({});
export type NotesListInput = typeof NotesListInput.Type;

export const NotesListResult = Schema.Struct({
  /** Newest edit first. */
  notes: Schema.Array(Note),
});
export type NotesListResult = typeof NotesListResult.Type;

export const NoteCreateInput = Schema.Struct({
  title: NoteTitle,
  body: NoteBody,
  createdByThreadId: Schema.optional(ThreadId),
});
export type NoteCreateInput = typeof NoteCreateInput.Type;

export const NoteUpdateInput = Schema.Struct({
  id: NoteId,
  title: Schema.optional(NoteTitle),
  body: Schema.optional(NoteBody),
});
export type NoteUpdateInput = typeof NoteUpdateInput.Type;

export const NoteDeleteInput = Schema.Struct({ id: NoteId });
export type NoteDeleteInput = typeof NoteDeleteInput.Type;

export const NoteDeleteResult = Schema.Struct({ id: NoteId });
export type NoteDeleteResult = typeof NoteDeleteResult.Type;

export class NotesError extends Schema.TaggedError<NotesError>()("NotesError", {
  kind: Schema.Literals(["not-found", "storage"]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
