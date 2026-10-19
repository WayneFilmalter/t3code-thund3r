import { NoteCategoryId, NoteId } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import {
  noteCategoryFromRow,
  noteFromRow,
  normalizeNoteCategoryName,
  normalizeNoteTitle,
  UNTITLED_CATEGORY_NAME,
  UNTITLED_NOTE_TITLE,
} from "./notes.logic.ts";

describe("normalizeNoteTitle", () => {
  it("trims and falls back for blank titles", () => {
    assert.equal(normalizeNoteTitle("  Standup  "), "Standup");
    assert.equal(normalizeNoteTitle("   "), UNTITLED_NOTE_TITLE);
    assert.equal(normalizeNoteTitle(""), UNTITLED_NOTE_TITLE);
  });
});

describe("noteFromRow", () => {
  it("maps columns and keeps a missing author null", () => {
    assert.deepEqual(
      noteFromRow({
        note_id: "n1",
        title: "T",
        body: "- [ ] a",
        created_at: "2026-10-15T10:00:00.000Z",
        updated_at: "2026-10-15T11:00:00.000Z",
        created_by_thread_id: null,
        category_id: null,
      }),
      {
        id: NoteId.make("n1"),
        title: "T",
        body: "- [ ] a",
        createdAt: "2026-10-15T10:00:00.000Z",
        updatedAt: "2026-10-15T11:00:00.000Z",
        createdByThreadId: null,
        categoryId: null,
      },
    );
  });
});

describe("normalizeNoteCategoryName", () => {
  it("trims and falls back for blank names", () => {
    assert.equal(normalizeNoteCategoryName("  Work "), "Work");
    assert.equal(normalizeNoteCategoryName(" "), UNTITLED_CATEGORY_NAME);
  });
});

describe("noteCategoryFromRow", () => {
  it("maps columns", () => {
    assert.deepEqual(
      noteCategoryFromRow({
        category_id: "c1",
        name: "Work",
        color: "blue",
        created_at: "2026-10-15T10:00:00.000Z",
      }),
      {
        id: NoteCategoryId.make("c1"),
        name: "Work",
        color: "blue",
        createdAt: "2026-10-15T10:00:00.000Z",
      },
    );
  });
});
