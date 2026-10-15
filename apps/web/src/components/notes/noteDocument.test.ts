// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { serializeEditorDoc } from "~/composer-rich-text-doc";

import { NOTE_EXTENSIONS, noteDoc, toggleListLines, toggleNoteList } from "./noteDocument";

describe("toggleListLines", () => {
  it.each([
    ["bullet", "a\nb\nc", "- a\n- b\n- c"],
    ["ordered", "a\nb\nc", "1. a\n2. b\n3. c"],
    ["task", "a\nb\nc", "- [ ] a\n- [ ] b\n- [ ] c"],
  ] as const)("makes every line a %s item", (kind, value, expected) => {
    expect(toggleListLines(value, 0, 2, kind)).toBe(expected);
  });

  it("takes the markers off when every line is already that kind", () => {
    expect(toggleListLines("- [ ] a\n- [x] b", 0, 1, "task")).toBe("a\nb");
    expect(toggleListLines("1. a\n2. b", 0, 1, "ordered")).toBe("a\nb");
  });

  it("makes the rest items when only some lines are", () => {
    expect(toggleListLines("- a\nb\n- c", 0, 2, "bullet")).toBe("- a\n- b\n- c");
  });

  it("changes the kind of lines that are another kind, keeping their indent", () => {
    expect(toggleListLines("- a\n  - b\n- c", 0, 2, "task")).toBe("- [ ] a\n  - [ ] b\n- [ ] c");
    expect(toggleListLines("1. a\n2. b", 0, 1, "bullet")).toBe("- a\n- b");
  });

  it("numbers nested runs on their own and renumbers a mixed selection", () => {
    expect(toggleListLines("a\n  b\n  c\nd", 0, 3, "ordered")).toBe("1. a\n  1. b\n  2. c\n2. d");
    expect(toggleListLines("1. a\nb\n2. c", 0, 2, "ordered")).toBe("1. a\n2. b\n3. c");
  });

  it("continues the numbered list above, in its style", () => {
    expect(toggleListLines("3) a\nb\nc", 1, 2, "ordered")).toBe("3) a\n4) b\n5) c");
    expect(toggleListLines("1. a\n\nb", 2, 2, "ordered")).toBe("1. a\n\n1. b");
  });

  it("leaves blank lines in a selection, but makes one at the caret an item", () => {
    expect(toggleListLines("a\n\nb", 0, 2, "bullet")).toBe("- a\n\n- b");
    expect(toggleListLines("a\n\nb", 1, 1, "bullet")).toBe("a\n- \nb");
    expect(toggleListLines("", 0, 0, "task")).toBe("- [ ] ");
  });

  it("leaves headings, quotes, rules and fences alone", () => {
    expect(toggleListLines("# Title\na\n> q\n---\nb", 0, 4, "bullet")).toBe(
      "# Title\n- a\n> q\n---\n- b",
    );
    expect(toggleListLines("```\nx\ny\n```\nz", 0, 4, "bullet")).toBe("```\nx\ny\n```\n- z");
    expect(toggleListLines("# Title", 0, 0, "bullet")).toBeNull();
  });

  it("touches only the selected lines", () => {
    expect(toggleListLines("a\nb\nc\nd", 1, 2, "task")).toBe("a\n- [ ] b\n- [ ] c\nd");
  });

  it("returns null when no line in the range can change", () => {
    expect(toggleListLines("```\nx\n```", 0, 2, "bullet")).toBeNull();
    expect(toggleListLines("a\n\n\nb", 1, 2, "bullet")).toBeNull();
  });
});

// ProseMirror's DOM observer can flush on a timer after a test ends, which
// throws once jsdom is torn down, so every editor is destroyed after its test.
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function makeEditor(value: string) {
  const editor = new Editor({ extensions: NOTE_EXTENSIONS, content: noteDoc(value) });
  editors.push(editor);
  return editor;
}

const stored = (editor: Editor) => serializeEditorDoc(editor.state.doc).value;

function select(editor: Editor, from: number, to = from) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

describe("toggleNoteList", () => {
  it("turns a selection over several lines into a list", () => {
    const editor = makeEditor("one\ntwo\nthree");
    select(editor, 2, 12);
    expect(toggleNoteList(editor, "bullet")).toBe(true);
    expect(stored(editor)).toBe("- one\n- two\n- three");
  });

  it("keeps the selection on its lines", () => {
    const editor = makeEditor("one\ntwo\nthree");
    select(editor, 2, 13);
    toggleNoteList(editor, "task");
    const { from, to, $from, $to } = editor.state.selection;
    expect($from.parent.textContent).toBe("one");
    expect($from.parentOffset).toBe(1);
    expect($to.parent.textContent).toBe("three");
    expect($to.parentOffset).toBe(2);
    expect(editor.state.doc.textBetween(from, to, "\n")).toBe("ne\ntwo\nth");
  });

  it("saves a numbered list with numbers", () => {
    const editor = makeEditor("one\ntwo");
    select(editor, 1, 7);
    toggleNoteList(editor, "ordered");
    expect(stored(editor)).toBe("1. one\n2. two");
    expect(editor.state.doc.firstChild?.type.name).toBe("orderedList");
  });

  it("lifts the selected items out of a list", () => {
    const editor = makeEditor("- one\n- two\n- three");
    select(editor, 3, 22);
    expect(editor.state.doc.textBetween(3, 22, "\n")).toBe("one\ntwo\nthree");
    toggleNoteList(editor, "bullet");
    expect(stored(editor)).toBe("one\ntwo\nthree");
  });

  it("changes one item in the middle of a list into a task", () => {
    const editor = makeEditor("- one\n- two\n- three");
    select(editor, 11);
    expect(editor.state.selection.$from.parent.textContent).toBe("two");
    toggleNoteList(editor, "task");
    expect(stored(editor)).toBe("- one\n- [ ] two\n- three");
    expect(editor.state.selection.$from.parent.textContent).toBe("two");
  });

  it("gives an empty line after a final rule an item of its own", () => {
    const editor = makeEditor("a\n---");
    select(editor, editor.state.doc.content.size - 1);
    toggleNoteList(editor, "bullet");
    expect(stored(editor)).toBe("a\n---\n- ");
  });

  it("does nothing on a heading and reports it", () => {
    const editor = makeEditor("# Title");
    select(editor, 2);
    expect(toggleNoteList(editor, "bullet")).toBe(false);
    expect(stored(editor)).toBe("# Title");
  });

  it("is one undo step", () => {
    const editor = makeEditor("one\ntwo");
    select(editor, 1, 7);
    toggleNoteList(editor, "task");
    expect(editor.commands.undo()).toBe(true);
    expect(stored(editor)).toBe("one\ntwo");
  });
});
