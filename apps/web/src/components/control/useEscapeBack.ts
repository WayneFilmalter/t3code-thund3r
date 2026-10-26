import { type KeyboardEvent, useEffect, useRef } from "react";

/**
 * Escape as the Back button for a Control window detail view. Spread the
 * result on the view's root: it takes focus when the view opens, so Escape
 * reaches it after a click, and it only answers keys from inside itself, so
 * other panels (btop's terminal) and portalled menus keep their own Escape.
 * A field holding unsent text gives up focus on the first Escape instead of
 * dropping the draft.
 */
export function useEscapeBack(onBack: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const root = ref.current;
    const target = event.target;
    if (root === null || !(target instanceof Node) || !root.contains(target)) return;
    event.preventDefault();
    if (
      (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
      target.value.trim().length > 0
    ) {
      root.focus({ preventScroll: true });
      return;
    }
    onBack();
  };

  return { ref, tabIndex: -1, onKeyDown };
}
