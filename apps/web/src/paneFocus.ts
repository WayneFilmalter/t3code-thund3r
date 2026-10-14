/**
 * Lets a view inside a split pane ask whether its pane owns window-level
 * input. ChatView registers window/document listeners (shortcuts, paste,
 * focus restoration) that must only act in the focused pane; outside split
 * panes the default handle is always focused and nothing changes.
 *
 * The handle is a stable object with getters rather than a boolean so that
 * consumers can check focus at event time without re-rendering the whole
 * view on every pane focus change.
 */
import { createContext, use, useSyncExternalStore } from "react";

export interface PaneFocusHandle {
  isFocused: () => boolean;
  /** Notifies on pane focus changes. Never fires outside split panes. */
  subscribe: (listener: () => void) => () => void;
}

export const ALWAYS_FOCUSED_PANE: PaneFocusHandle = {
  isFocused: () => true,
  subscribe: () => () => {},
};

export const PaneFocusContext = createContext<PaneFocusHandle>(ALWAYS_FOCUSED_PANE);

export function usePaneFocusHandle(): PaneFocusHandle {
  return use(PaneFocusContext);
}

/**
 * Where split panes host the single right panel: `host` sits beside the split
 * tree and `row` spans the tree plus the panel, for width clamping. Null
 * outside split panes, where each view renders its panel inline.
 */
export interface PanePanelPortal {
  readonly host: HTMLElement | null;
  readonly row: HTMLElement | null;
}

export const PanePanelPortalContext = createContext<PanePanelPortal | null>(null);

export function usePanePanelPortal(): PanePanelPortal | null {
  return use(PanePanelPortalContext);
}

/** Re-renders on pane focus changes; outside split panes it is always true. */
export function usePaneFocused(handle: PaneFocusHandle): boolean {
  return useSyncExternalStore(handle.subscribe, handle.isFocused, handle.isFocused);
}
