/**
 * The note body's document model: the chat composer's markdown document, so
 * what is saved is the markdown an agent would write and `ChatMarkdown`
 * renders. That model is prompt-box markdown: headings, lists, tasks, quotes,
 * rules, fences and inline marks are structure; links, images and tables stay
 * literal markdown text here and round-trip unchanged into the rendered view.
 */
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

import {
  bulletListInputRules,
  bulletToTaskInputRule,
  orderedListInputRules,
  taskInputRule,
} from "~/composer-list-input-rules";
import {
  buildDocJson,
  codeBlockSource,
  ComposerBlockExtensions,
  ComposerCodeBlockExtension,
  ComposerCodeExtension,
  ComposerListExtensions,
  ComposerTaskItemExtension,
  ComposerTaskListExtension,
  isClosingFence,
  parseListPrefix,
  parseOpeningFence,
  serializeEditorDoc,
} from "~/composer-rich-text-doc";

export const NOTE_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    link: false,
    orderedList: false,
    underline: false,
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
    code: false,
    // The list extensions handle Backspace and Delete themselves.
    listKeymap: false,
  }),
  ComposerCodeExtension,
  ComposerCodeBlockExtension,
  ...ComposerBlockExtensions,
  ...ComposerListExtensions.map((extension) =>
    extension.name === "listItem"
      ? extension
      : extension.extend({
          addInputRules() {
            return this.name === "bulletList" ? bulletListInputRules() : orderedListInputRules();
          },
        }),
  ),
  ComposerTaskListExtension,
  ComposerTaskItemExtension.extend({
    addInputRules() {
      return [taskInputRule(this.type), bulletToTaskInputRule];
    },
  }),
];

const noSkills = () => ({ label: "", description: null });

export function noteDoc(markdown: string) {
  return buildDocJson(markdown, noSkills, { styling: true, atoms: false });
}

export type NoteListKind = "bullet" | "ordered" | "task";

const RULE_LINE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/;
const HEADING_LINE = /^#{1,6}[ \t]+/;

/** A line the list buttons leave alone: a rule, a heading or a quote line. */
function isStructureLine(line: string): boolean {
  return RULE_LINE.test(line) || HEADING_LINE.test(line) || line.startsWith(">");
}

/**
 * The list buttons over markdown lines `lineFrom`–`lineTo`: when every text
 * line in the range is already an item of `kind`, the markers come off;
 * otherwise every text line becomes an item of `kind`, keeping its indent.
 * Lines that are not text lines stay as they are: headings, quotes, rules,
 * fences and their bodies, and blank lines in a selection that spans more
 * than one line (a single blank line at the caret does become an empty item,
 * so the button is a way to start a list). Ordered items are numbered on from
 * the ordered line before them at the same indent, so a selection appended to
 * a numbered list continues it.
 *
 * Returns the new value, or null when nothing in the range changes.
 */
export function toggleListLines(
  value: string,
  lineFrom: number,
  lineTo: number,
  kind: NoteListKind,
): string | null {
  const lines = value.split("\n");
  const single = lineFrom === lineTo;
  // Fence state runs from the top, so a line inside a fence that opened above
  // the selection is still code.
  let fence: string | null = null;
  const fenceLine = (line: string): boolean => {
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      return true;
    }
    const opening = parseOpeningFence(line);
    if (opening) fence = opening.fence;
    return opening !== null;
  };

  const candidates = new Set<number>();
  for (let index = 0; index < lines.length && index <= lineTo; index += 1) {
    const line = lines[index]!;
    if (fenceLine(line) || index < lineFrom) continue;
    if (isStructureLine(line) || (!single && line.trim() === "")) continue;
    candidates.add(index);
  }
  if (candidates.size === 0) return null;
  const listPrefix = (line: string) => (isStructureLine(line) ? null : parseListPrefix(line));
  const off = [...candidates].every((index) => listPrefix(lines[index]!)?.prefix.kind === kind);

  // The ordered run open at each indent, kept across untouched lines so a new
  // item continues the list it joins.
  const runs = new Map<string, { number: number; delimiter: string }>();
  const noteListLine = (indent: string, orderedMarker: string | null) => {
    for (const key of runs.keys()) if (key.length > indent.length) runs.delete(key);
    if (orderedMarker) {
      runs.set(indent, {
        number: Number.parseInt(orderedMarker, 10) || 0,
        delimiter: orderedMarker.slice(-1),
      });
    } else {
      runs.delete(indent);
    }
  };

  const out = [...lines];
  fence = null;
  const last = Math.max(...candidates);
  for (let index = 0; index <= last; index += 1) {
    const line = lines[index]!;
    if (fenceLine(line)) {
      runs.clear();
      continue;
    }
    const parsed = listPrefix(line);
    if (!candidates.has(index)) {
      if (!parsed) runs.clear();
      else
        noteListLine(
          parsed.prefix.indent,
          parsed.prefix.kind === "ordered" ? parsed.prefix.marker : null,
        );
      continue;
    }
    if (off) {
      out[index] = line.slice(parsed!.markerLength);
      runs.clear();
      continue;
    }
    const content = parsed ? line.slice(parsed.markerLength) : line.trimStart();
    const indent = parsed ? parsed.prefix.indent : line.slice(0, line.length - content.length);
    const typedSpace = parsed
      ? parsed.prefix.kind === "task"
        ? parsed.prefix.markerSpace
        : parsed.prefix.space
      : " ";
    const space = typedSpace || " ";
    if (kind === "ordered") {
      const run = runs.get(indent);
      const marker = `${(run?.number ?? 0) + 1}${run?.delimiter ?? "."}`;
      out[index] = `${indent}${marker}${space}${content}`;
      noteListLine(indent, marker);
    } else if (parsed?.prefix.kind === kind) {
      noteListLine(indent, null);
    } else {
      out[index] =
        kind === "task" ? `${indent}-${space}[ ] ${content}` : `${indent}-${space}${content}`;
      noteListLine(indent, null);
    }
  }
  const next = out.join("\n");
  return next === value ? null : next;
}

const LIST_NODE_NAMES = new Set(["bulletList", "orderedList", "taskList"]);

/** How many markdown lines the top-level block at `index` writes. */
function blockLineCount(doc: ProseMirrorNode, index: number): number {
  const block = doc.child(index);
  if (block.type.name === "codeBlock") {
    const { open, content, close } = codeBlockSource(block, index < doc.childCount - 1);
    return (open + content + close).split("\n").length;
  }
  if (block.type.name === "blockquote") return block.childCount;
  if (LIST_NODE_NAMES.has(block.type.name)) {
    let count = 0;
    block.descendants((node) => {
      if (node.isTextblock) count += 1;
      return !node.isTextblock;
    });
    return count;
  }
  return 1;
}

/** The markdown line the textblock holding `$pos` writes. */
function lineIndexAt(doc: ProseMirrorNode, $pos: ResolvedPos): number {
  let lines = 0;
  for (let index = 0; index < $pos.index(0); index += 1) lines += blockLineCount(doc, index);
  const block = $pos.node(1);
  if (LIST_NODE_NAMES.has(block.type.name)) {
    doc.nodesBetween($pos.before(1), $pos.before(), (node) => {
      if (node.isTextblock) lines += 1;
      return !node.isTextblock;
    });
  } else if (block.type.name === "blockquote") {
    lines += $pos.index(1);
  }
  return lines;
}

function textblockPositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) positions.push(pos);
    return !node.isTextblock;
  });
  return positions;
}

/**
 * The toolbar's list buttons. Tiptap's own toggle wraps every selected line
 * into one item and splits it afterwards, which an item that holds a single
 * line refuses, so a selection over several lines did nothing; and the items
 * it makes carry no source marker, so a numbered list came out as bullets.
 * The note is markdown, so the buttons edit it as lines (`toggleListLines`)
 * and the document is rebuilt from the result in one transaction. The caret
 * and selection stay on their lines: a line is a textblock before and after.
 */
export function toggleNoteList(editor: Editor, kind: NoteListKind): boolean {
  const { state } = editor;
  const { doc, selection } = state;
  const { $from, $to } = selection;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
  let value = serializeEditorDoc(doc).value;
  // The empty line after a final rule writes nothing, so give it a line.
  const lastIndex = doc.childCount - 1;
  if (
    lastIndex > 0 &&
    doc.child(lastIndex).type.name === "paragraph" &&
    doc.child(lastIndex).content.size === 0 &&
    doc.child(lastIndex - 1).type.name === "horizontalRule"
  ) {
    value += "\n";
  }
  const next = toggleListLines(value, lineIndexAt(doc, $from), lineIndexAt(doc, $to), kind);
  if (next === null) return false;

  const before = textblockPositions(doc);
  const fromLine = before.indexOf($from.before());
  const toLine = before.indexOf($to.before());
  const content = noteDoc(next).content.map((json) => state.schema.nodeFromJSON(json));
  const tr = state.tr.replaceWith(0, doc.content.size, content);
  const after = textblockPositions(tr.doc);
  const place = (line: number, offset: number): number | null => {
    const pos = after[line];
    if (pos === undefined) return null;
    const textblock = tr.doc.nodeAt(pos)!;
    return pos + 1 + Math.min(offset, textblock.content.size);
  };
  const from = place(fromLine, $from.parentOffset);
  const to = place(toLine, $to.parentOffset);
  tr.setSelection(
    from !== null && to !== null
      ? TextSelection.create(tr.doc, from, to)
      : Selection.near(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size))),
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
