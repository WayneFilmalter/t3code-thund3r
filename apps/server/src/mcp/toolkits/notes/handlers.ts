import { OrchestratorMcpFailure, type NotesError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as NotesService from "../../../notes/NotesService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, unavailable } from "../../threadAccess.ts";
import { NotesToolkit } from "./tools.ts";

const notesFailure = (error: NotesError) =>
  error.kind === "not-found"
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.detail })
    : unavailable();

export const layer = McpToolAccess.toLayer(NotesToolkit, {
  t3_note_list: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const notes = yield* NotesService.NotesService;
      return yield* notes.list().pipe(Effect.mapError(notesFailure));
    }),
  ),
  t3_note_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const notes = yield* NotesService.NotesService;
      const { notes: all } = yield* notes.list().pipe(Effect.mapError(notesFailure));
      const note = all.find((entry) => entry.id === input.noteId);
      if (note === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `Note ${input.noteId} was not found.`,
        });
      }
      return note;
    }),
  ),
  t3_note_create: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      // The calling thread is recorded so the panel can tell an agent's note from the user's.
      const { caller } = yield* readCaller();
      const notes = yield* NotesService.NotesService;
      return yield* notes
        .create({
          title: input.title,
          body: input.body,
          ...(caller === undefined ? {} : { createdByThreadId: caller.id }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        })
        .pipe(Effect.mapError(notesFailure));
    }),
  ),
  t3_note_update: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const notes = yield* NotesService.NotesService;
      return yield* notes
        .update({
          id: input.noteId,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        })
        .pipe(Effect.mapError(notesFailure));
    }),
  ),
});
