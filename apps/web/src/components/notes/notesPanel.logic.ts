import type { Note, NoteId, ThreadId } from "@t3tools/contracts";

/** The first line of prose in a body: skips headings, blank lines and rules, strips list markers. */
export function notePreviewLine(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^([-*_])(?:[ \t]*\1){2,}$/.test(line)) continue;
    if (/^(`{3,}|~{3,})/.test(line)) continue;
    return line
      .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, "")
      .replace(/^>\s?/, "")
      .trim();
  }
  return "";
}

/** A title to show when the stored one is blank. */
export function noteDisplayTitle(note: Pick<Note, "title">): string {
  const trimmed = note.title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled note";
}

/** A title for a note created from text alone: the first heading or line, trimmed to fit. */
export function noteTitleFromText(text: string, maxLength = 80): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, "");
    if (line.length === 0) continue;
    return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line;
  }
  return "Untitled note";
}

export function findNote(notes: ReadonlyArray<Note>, id: NoteId | null): Note | null {
  if (id === null) return null;
  return notes.find((note) => note.id === id) ?? null;
}

/** The note an agent thread wrote through MCP, if it has arrived in the list. */
export function noteWrittenByThread(notes: ReadonlyArray<Note>, threadId: ThreadId): Note | null {
  return notes.find((note) => note.createdByThreadId === threadId) ?? null;
}

/** Counts of done and total task-list items, for the list row. */
export function noteTaskProgress(body: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const line of body.split("\n")) {
    const match = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line);
    if (!match) continue;
    total += 1;
    if (match[1] !== " ") done += 1;
  }
  return total === 0 ? null : { done, total };
}
