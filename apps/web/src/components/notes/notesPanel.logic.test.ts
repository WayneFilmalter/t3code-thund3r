import type { Note } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findNote,
  noteDisplayTitle,
  notePreviewLine,
  noteTaskProgress,
  noteTitleFromText,
  noteWrittenByThread,
} from "./notesPanel.logic";
import { buildNoteAgentPrompt, noteAgentThreadTitle } from "./notesAgent";

const note = (overrides: Partial<Note>): Note => ({
  id: "n1" as Note["id"],
  title: "Standup",
  body: "",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  createdByThreadId: null,
  ...overrides,
});

describe("notePreviewLine", () => {
  it("skips headings, rules and fences and strips list markers", () => {
    expect(notePreviewLine("# Title\n\n---\n- [ ] ship it\nmore")).toBe("ship it");
    expect(notePreviewLine("```ts\ncode\n```\n1. first")).toBe("code");
    expect(notePreviewLine("> quoted")).toBe("quoted");
    expect(notePreviewLine("# only a heading")).toBe("");
  });
});

describe("noteTitleFromText", () => {
  it("takes the first heading or line and truncates", () => {
    expect(noteTitleFromText("\n## Research: caching\nbody")).toBe("Research: caching");
    expect(noteTitleFromText("x".repeat(100), 10)).toBe("xxxxxxxxx…");
    expect(noteTitleFromText("   ")).toBe("Untitled note");
  });
});

describe("noteDisplayTitle", () => {
  it("falls back for blank titles", () => {
    expect(noteDisplayTitle({ title: "  " })).toBe("Untitled note");
    expect(noteDisplayTitle({ title: " Plan " })).toBe("Plan");
  });
});

describe("noteTaskProgress", () => {
  it("counts task items, case-insensitively", () => {
    expect(noteTaskProgress("- [ ] a\n- [x] b\n  - [X] c\n- plain")).toEqual({
      done: 2,
      total: 3,
    });
    expect(noteTaskProgress("no tasks")).toBeNull();
  });
});

describe("findNote / noteWrittenByThread", () => {
  it("finds by id and by author thread", () => {
    const agentNote = note({ id: "n2" as Note["id"], createdByThreadId: "t1" as never });
    const notes = [note({}), agentNote];
    expect(findNote(notes, "n2" as Note["id"])).toBe(agentNote);
    expect(findNote(notes, null)).toBeNull();
    expect(noteWrittenByThread(notes, "t1" as never)).toBe(agentNote);
    expect(noteWrittenByThread(notes, "t9" as never)).toBeNull();
  });
});

describe("note agent prompt", () => {
  it("names the create tool for a new note", () => {
    const prompt = buildNoteAgentPrompt("Compare SQLite WAL modes", null);
    expect(prompt).toContain("t3_note_create");
    expect(prompt).toContain("Compare SQLite WAL modes");
    expect(prompt).not.toContain("t3_note_update");
  });

  it("names the update tool and the note id when continuing a note", () => {
    const prompt = buildNoteAgentPrompt(
      "Add a section on costs",
      note({ id: "abc" as Note["id"], body: "- [ ] existing" }),
    );
    expect(prompt).toContain("t3_note_update");
    expect(prompt).toContain('noteId "abc"');
    expect(prompt).toContain("- [ ] existing");
  });

  it("titles the thread from the request", () => {
    expect(noteAgentThreadTitle("Compare SQLite WAL modes")).toBe(
      "✎ Note: Compare SQLite WAL modes",
    );
    expect(noteAgentThreadTitle("x".repeat(60))).toBe(`✎ Note: ${"x".repeat(39)}…`);
  });
});
