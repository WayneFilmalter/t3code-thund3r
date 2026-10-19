import type { Note, NoteCategory } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canCreateCategoryNamed,
  filterCategories,
  findNote,
  groupNotesByCategory,
  noteDisplayTitle,
  notePreviewLine,
  noteTaskProgress,
  noteTitleFromText,
  noteWrittenByThread,
  UNCATEGORISED_GROUP_KEY,
} from "./notesPanel.logic";
import { buildNoteAgentPrompt, noteAgentThreadTitle } from "./notesAgent";

const note = (overrides: Partial<Note>): Note => ({
  id: "n1" as Note["id"],
  title: "Standup",
  body: "",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  createdByThreadId: null,
  categoryId: null,
  ...overrides,
});

const category = (id: string, name: string): NoteCategory => ({
  id: id as NoteCategory["id"],
  name,
  color: "blue",
  createdAt: "2026-10-15T10:00:00.000Z",
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

describe("groupNotesByCategory", () => {
  const work = category("c-work", "Work");
  const home = category("c-home", "Home");

  it("keeps category order, lists empty categories, and puts loose notes last", () => {
    const filed = note({ id: "n1" as Note["id"], categoryId: home.id });
    const loose = note({ id: "n2" as Note["id"] });
    const orphan = note({ id: "n3" as Note["id"], categoryId: "gone" as Note["categoryId"] });
    const groups = groupNotesByCategory([filed, loose, orphan], [work, home]);
    expect(groups.map((group) => group.key)).toEqual([work.id, home.id, UNCATEGORISED_GROUP_KEY]);
    expect(groups[0]?.notes).toEqual([]);
    expect(groups[1]?.notes.map((entry) => entry.id)).toEqual([filed.id]);
    // A note whose category vanished mid-stream reads as uncategorised, not lost.
    expect(groups[2]?.notes.map((entry) => entry.id)).toEqual([loose.id, orphan.id]);
  });

  it("omits the uncategorised group when every note is filed", () => {
    const groups = groupNotesByCategory([note({ categoryId: work.id })], [work]);
    expect(groups.map((group) => group.key)).toEqual([work.id]);
  });
});

describe("filterCategories / canCreateCategoryNamed", () => {
  const all = [category("a", "Work"), category("b", "Homework")];
  it("matches case-insensitively and offers creation only for unused names", () => {
    expect(filterCategories(all, "  ").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(filterCategories(all, "WORK").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(filterCategories(all, "home").map((entry) => entry.id)).toEqual(["b"]);
    expect(canCreateCategoryNamed(all, "work")).toBe(false);
    expect(canCreateCategoryNamed(all, "Play ")).toBe(true);
    expect(canCreateCategoryNamed(all, "")).toBe(false);
  });
});
