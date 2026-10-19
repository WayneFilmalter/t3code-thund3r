import type { NoteCategoryColor } from "@t3tools/contracts";

/**
 * How each category colour name looks on screen. Static class strings so
 * Tailwind keeps them; `card` tints a note row, `dot` marks the category
 * itself in headers, menus and swatches.
 */
export const NOTE_CATEGORY_COLOR_CLASSES: Record<
  NoteCategoryColor,
  { readonly label: string; readonly dot: string; readonly card: string }
> = {
  gray: {
    label: "Gray",
    dot: "bg-zinc-400",
    card: "border-zinc-400/40 bg-zinc-400/10 hover:bg-zinc-400/20",
  },
  red: {
    label: "Red",
    dot: "bg-red-500",
    card: "border-red-500/40 bg-red-500/10 hover:bg-red-500/20",
  },
  orange: {
    label: "Orange",
    dot: "bg-orange-500",
    card: "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20",
  },
  yellow: {
    label: "Yellow",
    dot: "bg-yellow-500",
    card: "border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20",
  },
  green: {
    label: "Green",
    dot: "bg-green-500",
    card: "border-green-500/40 bg-green-500/10 hover:bg-green-500/20",
  },
  teal: {
    label: "Teal",
    dot: "bg-teal-500",
    card: "border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20",
  },
  blue: {
    label: "Blue",
    dot: "bg-blue-500",
    card: "border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20",
  },
  purple: {
    label: "Purple",
    dot: "bg-purple-500",
    card: "border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20",
  },
  pink: {
    label: "Pink",
    dot: "bg-pink-500",
    card: "border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20",
  },
};

/** The row look for a note with no category. */
export const UNCATEGORISED_CARD_CLASS = "border-border/60 bg-card/40 hover:bg-accent/60";
