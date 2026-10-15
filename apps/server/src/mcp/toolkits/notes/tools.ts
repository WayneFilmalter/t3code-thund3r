import {
  Note,
  NoteBody,
  NoteId,
  NoteTitle,
  NotesListResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as NotesService from "../../../notes/NotesService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    NotesService.NotesService,
  ],
};

const NOTES_ARE =
  "Notes are the user's own markdown documents on this server, shown in the app's Notes panel. They belong to no project or thread.";
const BODY_STYLE =
  "Write the body in GitHub-flavoured markdown: headings, bullet lists, and `- [ ]` task lines, which the panel renders as checkboxes.";

const NoteListTool = Tool.make("t3_note_list", {
  ...shared,
  description: `List every note, newest edit first, with full bodies. ${NOTES_ARE}`,
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which MCP accepts as an object root.
  success: NotesListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const NoteReadTool = Tool.make("t3_note_read", {
  ...shared,
  description: `Read one note by id. ${NOTES_ARE}`,
  parameters: Schema.Struct({ noteId: NoteId }),
  success: Note,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const NoteCreateTool = Tool.make("t3_note_create", {
  ...shared,
  description: `Create a note the user will see in the Notes panel. ${NOTES_ARE} ${BODY_STYLE} Use this when asked to research something and save the result as a note.`,
  parameters: Schema.Struct({
    title: NoteTitle.annotate({ description: "Short title, at most 200 characters." }),
    body: NoteBody.annotate({ description: "Markdown body, at most 64 KB." }),
  }),
  success: Note,
}).annotate(Tool.Destructive, false);

const NoteUpdateTool = Tool.make("t3_note_update", {
  ...shared,
  description: `Replace a note's title and/or body. Omitted fields keep their current value; a given body replaces the whole body, so read the note first and include what should stay. ${BODY_STYLE}`,
  parameters: Schema.Struct({
    noteId: NoteId,
    title: Schema.optional(NoteTitle),
    body: Schema.optional(NoteBody),
  }),
  success: Note,
}).annotate(Tool.Destructive, true);

export const NotesToolkit = Toolkit.make(
  NoteListTool,
  NoteReadTool,
  NoteCreateTool,
  NoteUpdateTool,
);
