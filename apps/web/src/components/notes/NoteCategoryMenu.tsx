import type { NoteCategory, NoteCategoryColor, NoteCategoryId } from "@t3tools/contracts";
import { NOTE_CATEGORY_COLORS } from "@t3tools/contracts";
import { CircleDashedIcon, PlusIcon, SearchIcon, TagIcon } from "lucide-react";
import { useState } from "react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/components/ui/menu";
import { cn } from "~/lib/utils";

import { NOTE_CATEGORY_COLOR_CLASSES } from "./noteCategoryColors";
import { canCreateCategoryNamed, filterCategories } from "./notesPanel.logic";

const NONE = "";

export function NoteCategoryDot(props: { color: NoteCategoryColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        NOTE_CATEGORY_COLOR_CLASSES[props.color].dot,
        props.className,
      )}
    />
  );
}

/**
 * The "Category" submenu shared by a note's "…" menu and the list's right-click
 * menu: a search box, the categories as radio items, and a pinned "Create"
 * item at the bottom that carries the typed name along.
 */
export function NoteCategorySubmenu(props: {
  categories: ReadonlyArray<NoteCategory>;
  value: NoteCategoryId | null;
  disabled?: boolean;
  onSelect: (categoryId: NoteCategoryId | null) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = filterCategories(props.categories, query);
  const offerName = canCreateCategoryNamed(props.categories, query);
  const current = props.categories.find((category) => category.id === props.value) ?? null;
  return (
    <MenuSub>
      <MenuSubTrigger disabled={props.disabled}>
        <TagIcon aria-hidden className="size-3.5" />
        <span className="flex-1">Category</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current?.name ?? "None"}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="w-56">
        <div className="p-1 pb-2">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              size="compact"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                // Typing must not drive the menu's typeahead; arrows and Escape still do.
                if (event.key === "Enter" && offerName) {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onCreate(query.trim());
                  return;
                }
                if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
              }}
              placeholder="Search categories"
              aria-label="Search categories"
            />
          </InputGroup>
        </div>
        <MenuRadioGroup
          value={props.value ?? NONE}
          onValueChange={(next) =>
            props.onSelect(next === NONE ? null : (String(next) as NoteCategoryId))
          }
        >
          {query.trim().length === 0 ? (
            <MenuRadioItem value={NONE}>
              <span className="flex min-w-0 items-center gap-2">
                <CircleDashedIcon aria-hidden className="size-3.5 text-muted-foreground" />
                No category
              </span>
            </MenuRadioItem>
          ) : null}
          {visible.map((category) => (
            <MenuRadioItem key={category.id} value={category.id}>
              <span className="flex min-w-0 items-center gap-2">
                <NoteCategoryDot color={category.color} />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
              </span>
            </MenuRadioItem>
          ))}
          {visible.length === 0 && !offerName ? (
            <MenuItem disabled>No categories found</MenuItem>
          ) : null}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem disabled={props.disabled} onClick={() => props.onCreate(query.trim())}>
          <PlusIcon aria-hidden className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            {offerName ? `Create "${query.trim()}"` : "Create category…"}
          </span>
        </MenuItem>
      </MenuSubPopup>
    </MenuSub>
  );
}

/** A row of colour swatches, radio-style. Used by the category dialog and the header menu. */
export function NoteCategoryColorSwatches(props: {
  value: NoteCategoryColor;
  disabled?: boolean;
  onChange: (color: NoteCategoryColor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Category colour" className="flex flex-wrap gap-2">
      {NOTE_CATEGORY_COLORS.map((color) => {
        const selected = color === props.value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={NOTE_CATEGORY_COLOR_CLASSES[color].label}
            disabled={props.disabled}
            onClick={() => props.onChange(color)}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-64",
              selected ? "border-foreground" : "border-transparent hover:border-border",
            )}
          >
            <span className={cn("size-4 rounded-full", NOTE_CATEGORY_COLOR_CLASSES[color].dot)} />
          </button>
        );
      })}
    </div>
  );
}
