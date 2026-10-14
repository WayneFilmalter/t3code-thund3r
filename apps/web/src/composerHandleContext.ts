import { createContext, use } from "react";
import type { ChatComposerHandle } from "./components/chat/ChatComposer";

export type ComposerHandleRef = React.RefObject<ChatComposerHandle | null>;

export const ComposerHandleContext = createContext<ComposerHandleRef | null>(null);

export function useComposerHandleContext(): ComposerHandleRef | null {
  return use(ComposerHandleContext);
}

/**
 * A composer ref that stores the handle locally and mirrors it into the shared
 * context ref only while `isFocused()` holds, so a view in an unfocused split
 * pane cannot steal the handle the palette and file browser act on.
 */
export function createPaneScopedComposerRef(
  local: ComposerHandleRef,
  shared: ComposerHandleRef | null,
  isFocused: () => boolean,
): ComposerHandleRef {
  return {
    get current() {
      return local.current;
    },
    set current(handle: ChatComposerHandle | null) {
      local.current = handle;
      if (shared && isFocused()) {
        shared.current = handle;
      }
    },
  };
}
