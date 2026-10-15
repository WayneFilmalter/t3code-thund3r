import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  ItalicIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  SquareCodeIcon,
  TextQuoteIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { serializeEditorDoc } from "~/composer-rich-text-doc";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { NOTE_EXTENSIONS, noteDoc, toggleNoteList } from "./noteDocument";

type ToolbarAction =
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "heading1"
  | "heading2"
  | "bold"
  | "italic"
  | "code"
  | "codeBlock"
  | "blockquote";

const TOOLBAR: ReadonlyArray<{
  action: ToolbarAction;
  label: string;
  Icon: typeof ListIcon;
}> = [
  { action: "bulletList", label: "Bullet list", Icon: ListIcon },
  { action: "orderedList", label: "Numbered list", Icon: ListOrderedIcon },
  { action: "taskList", label: "Checklist", Icon: ListChecksIcon },
  { action: "heading1", label: "Heading", Icon: Heading1Icon },
  { action: "heading2", label: "Subheading", Icon: Heading2Icon },
  { action: "bold", label: "Bold", Icon: BoldIcon },
  { action: "italic", label: "Italic", Icon: ItalicIcon },
  { action: "code", label: "Inline code", Icon: CodeIcon },
  { action: "codeBlock", label: "Code block", Icon: SquareCodeIcon },
  { action: "blockquote", label: "Quote", Icon: TextQuoteIcon },
];

export function NoteTiptapEditor(props: {
  /** Markdown the editor starts from; remount with a new `key` to load another note. */
  initialValue: string;
  onChange: (markdown: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { onChange } = props;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: NOTE_EXTENSIONS,
    content: noteDoc(props.initialValue),
    editable: !props.disabled,
    autofocus: props.autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: cn(
          "composer-tiptap block min-h-40 flex-1 px-3 py-2 whitespace-pre-wrap wrap-break-word leading-relaxed text-foreground outline-none",
        ),
        "aria-label": "Note body",
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(serializeEditorDoc(instance.state.doc).value);
    },
  });

  useEffect(() => {
    editor?.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bulletList: instance.isActive("bulletList"),
      orderedList: instance.isActive("orderedList"),
      taskList: instance.isActive("taskList"),
      heading1: instance.isActive("heading", { level: 1 }),
      heading2: instance.isActive("heading", { level: 2 }),
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      code: instance.isActive("code"),
      codeBlock: instance.isActive("codeBlock"),
      blockquote: instance.isActive("blockquote"),
    }),
  });

  const run = (action: ToolbarAction) => {
    if (!editor) return;
    editor.commands.focus();
    const chain = editor.chain();
    switch (action) {
      case "bulletList":
        toggleNoteList(editor, "bullet");
        return;
      case "orderedList":
        toggleNoteList(editor, "ordered");
        return;
      case "taskList":
        toggleNoteList(editor, "task");
        return;
      case "heading1":
        chain.toggleHeading({ level: 1 }).run();
        return;
      case "heading2":
        chain.toggleHeading({ level: 2 }).run();
        return;
      case "bold":
        chain.toggleBold().run();
        return;
      case "italic":
        chain.toggleItalic().run();
        return;
      case "code":
        chain.toggleCode().run();
        return;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        return;
      case "blockquote":
        chain.toggleBlockquote().run();
        return;
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-lg border border-input bg-background dark:bg-input/32",
        props.className,
      )}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 border-b border-border/60 px-1.5 py-1"
      >
        {TOOLBAR.map(({ action, label, Icon }) => (
          <Tooltip key={action}>
            <TooltipTrigger
              render={
                <Toggle
                  variant="ghost"
                  size="xs"
                  aria-label={label}
                  pressed={active?.[action] ?? false}
                  disabled={props.disabled}
                  // Pointer down would move focus out of the document and drop the selection.
                  onMouseDown={(event) => event.preventDefault()}
                  onPressedChange={() => run(action)}
                />
              }
            >
              <Icon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col" />
      </div>
    </div>
  );
}
