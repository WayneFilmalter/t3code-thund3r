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
import { createContext, use } from "react";

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
