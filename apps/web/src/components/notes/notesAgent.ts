/**
 * "Draft with agent": one agent turn on a fresh thread researches or writes
 * what the user asked for and saves it through the `t3_note_create` /
 * `t3_note_update` MCP tools. The panel sees the note arrive on the live list;
 * this module only starts the turn, waits for it, and covers the case where
 * the agent answered in chat instead of saving.
 */
import type { Note, ScopedProjectRef, ThreadId } from "@t3tools/contracts";

import type { RunnerPorts } from "~/workflows/workflowRunner.ports";
import type { WorkflowInstanceThread } from "~/workflowsStore";

import { noteTitleFromText } from "./notesPanel.logic";

const THREAD_TITLE_MAX = 40;
/** How long to let the live note list catch up after the agent's turn settles. */
const NOTE_ARRIVAL_GRACE_MS = 3_000;

export function noteAgentThreadTitle(request: string): string {
  const compact = request.trim().replace(/\s+/g, " ");
  const head =
    compact.length > THREAD_TITLE_MAX
      ? `${compact.slice(0, THREAD_TITLE_MAX - 1).trimEnd()}…`
      : compact;
  return `✎ Note: ${head}`;
}

/** The message sent to the agent. `target` is the note to extend, or null for a new one. */
export function buildNoteAgentPrompt(request: string, target: Note | null): string {
  const style =
    "Write the note body in GitHub-flavoured markdown: short headings, bullet lists, and `- [ ]` task lines for anything actionable (the app renders them as checkboxes). Links are welcome. No preamble inside the note.";
  if (target === null) {
    return `You are writing a note for the user's Notes panel in T3 Code. Do the research or thinking the request below asks for (read the codebase or search the web if that helps), then save the result as a new note by calling the \`t3_note_create\` MCP tool with a short title and the markdown body. Do not change any files.

${style}

Request:
${request.trim()}

Call \`t3_note_create\` exactly once, then reply with one line saying the note is saved.`;
  }
  return `You are extending an existing note in the user's Notes panel in T3 Code. Do what the request below asks for (read the codebase or search the web if that helps), then save the result by calling the \`t3_note_update\` MCP tool with noteId "${target.id}" and the complete new markdown body. The body you pass replaces the whole note, so keep everything that should stay. Do not change any files.

${style}

Current note title: ${target.title}
Current note body:
${target.body}

Request:
${request.trim()}

Call \`t3_note_update\` exactly once, then reply with one line saying the note is updated.`;
}

export type NoteAgentResult = { ok: true } | { ok: false; error: string };

export interface NoteAgentHooks {
  /** Resolves once the live list shows the agent's write, or false after a short grace. */
  readonly awaitNoteWritten: (threadId: ThreadId, graceMs: number) => Promise<boolean>;
  /** Fallback when the agent answered in chat instead of saving. */
  readonly createNote: (title: string, body: string) => Promise<boolean>;
}

/**
 * Run the drafting turn and wait for it. `onThread` fires as soon as the thread
 * exists so the UI can offer to open it. Aborting stops waiting and interrupts
 * the turn; the thread itself stays.
 */
export async function draftNoteWithAgent(
  ports: RunnerPorts,
  projectRef: ScopedProjectRef,
  request: string,
  target: Note | null,
  signal: AbortSignal,
  onThread: (thread: WorkflowInstanceThread) => void,
  hooks: NoteAgentHooks,
): Promise<NoteAgentResult> {
  const started = await ports.startAgent(
    {
      instanceKey: "note",
      title: noteAgentThreadTitle(request),
      prompt: buildNoteAgentPrompt(request, target),
      modelSelection: null,
      interactionMode: "default",
      runtimeMode: "auto",
      envMode: "local",
      session: { kind: "new" },
    },
    projectRef,
  );
  if (!started.ok) return { ok: false, error: started.error };
  onThread(started.thread);
  const settled = await ports.waitForSettled(started.thread, signal);
  if (settled.kind === "aborted") {
    void ports.interrupt(started.thread);
    return { ok: false, error: "Cancelled." };
  }
  if (settled.kind === "deleted") return { ok: false, error: "The drafting thread was deleted." };
  if (settled.turnState !== "completed") {
    return {
      ok: false,
      error:
        settled.turnState === "interrupted" ? "The agent was interrupted." : "The agent errored.",
    };
  }
  // Extending a note: the update shows on the list by itself; nothing to recover.
  if (target !== null) return { ok: true };
  if (await hooks.awaitNoteWritten(started.thread.threadId, NOTE_ARRIVAL_GRACE_MS)) {
    return { ok: true };
  }
  // The agent replied in chat instead of calling the tool: keep its answer as the note.
  const harvested = await ports.harvest(started.thread);
  const body = harvested.text.trim();
  if (body.length === 0) {
    return { ok: false, error: "The agent finished without writing a note." };
  }
  return (await hooks.createNote(noteTitleFromText(body), body))
    ? { ok: true }
    : { ok: false, error: "The agent's answer could not be saved as a note." };
}
