/**
 * Typing gestures that turn a line into a list: `- `, `* `, `1. ` and the GFM
 * task forms `- [ ] ` / `[ ] `. Shared by the chat composer and the notes
 * editor, which both store markdown and edit it as a Tiptap document.
 */
import { InputRule, wrappingInputRule } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";

import { convertBulletItemToTask } from "~/composer-rich-text-doc";

/**
 * A list marker typed at the start of a top-level paragraph. The `-` form
 * waits for the first character after the space, which it carries into the
 * new item. That is what lets the GFM task gesture `- [ ] ` or `- [x] ` be
 * typed whole and reach the task rule, instead of being cut off by an instant
 * bullet. A `- ` left on its own is still a bullet the next time the draft is
 * rebuilt.
 */
export function listMarkerInputRule(
  find: RegExp,
  listType: "bulletList" | "orderedList",
): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match, chain }) => {
      const marker = match.groups?.marker ?? "-";
      const space = match.groups?.space ?? " ";
      const carried = match.groups?.carried ?? "";
      // Top-level paragraphs only: inside an item or a quote the new list
      // would nest under a line the stored draft writes flat.
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null;
      const command = chain()
        .deleteRange(range)
        .wrapInList(
          listType,
          listType === "orderedList" ? { start: Number.parseInt(marker, 10) || 1 } : {},
        )
        .updateAttributes("listItem", { marker, space });
      (carried ? command.insertContent(carried) : command).run();
      return undefined;
    },
  });
}

/** The bullet-list rules: `*`/`+` convert at once, `-` waits for its first character. */
export const bulletListInputRules = () => [
  listMarkerInputRule(/^(?<marker>[*+])(?<space>\s)$/, "bulletList"),
  listMarkerInputRule(/^(?<marker>-)(?<space>[ \t]+)(?<carried>[^\s[])$/, "bulletList"),
];

export const orderedListInputRules = () => [
  listMarkerInputRule(/^(?<marker>\d+[.)])(?<space>\s)$/, "orderedList"),
];

/**
 * `[ ] ` at the start of an existing bullet item turns it into a task, for
 * items that were already a list when the checkbox was wanted. New tasks are
 * typed whole, `- [ ] `, and reach the task rule directly.
 */
export const bulletToTaskInputRule = new InputRule({
  find: /^\[([ xX])\] $/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from);
    const item = $from.node(-1);
    if ($from.parent.type.name !== "paragraph" || item?.type.name !== "listItem") return null;
    // Any bullet converts; the task grammar only knows `-`, so a `*` or `+`
    // item comes back out as `- [ ]`.
    if (!["-", "*", "+"].includes((item.attrs as { marker?: string }).marker ?? "")) return null;
    const checked = (match[1] ?? " ").toLowerCase() === "x";
    chain()
      .command(({ tr }) => {
        convertBulletItemToTask(tr, range.from, range.to, checked);
        return true;
      })
      .run();
    return undefined;
  },
});

/** `- [ ] ` or `- [x] ` at a top-level paragraph, for the same reason as the list markers. */
export function taskInputRule(type: NodeType): InputRule {
  const rule = wrappingInputRule({
    find: /^- \[([ xX])\] $/,
    type,
    getAttributes: (match) => ({ checked: match[1]?.toLowerCase() === "x" }),
  });
  return new InputRule({
    find: rule.find,
    handler: (props) =>
      props.state.doc.resolve(props.range.from).depth === 1 ? rule.handler(props) : null,
  });
}
