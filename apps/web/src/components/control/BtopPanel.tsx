import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "~/appearanceFonts";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import { TerminalViewport } from "../ThreadTerminalDrawer";
import { BTOP_TERMINAL_ID, CONTROL_THREAD_ID, useBtopSession } from "./btopSession";

const noop = () => {};

/**
 * Control window panel running btop on this machine. Each mount starts a fresh
 * btop; the main window stops it when the Control window closes.
 */
export function BtopPanel() {
  const btop = useBtopSession();
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [status, setStatus] = useState<"starting" | "ready" | "failed">("starting");
  const startQueueRef = useRef(Promise.resolve());
  const { environmentId, cwd, keybindings, canOperate } = btop;
  const ready = environmentId !== null && cwd !== null && keybindings !== null && canOperate;
  const startBtop = useEffectEvent(() => btop.start());
  const threadRef = useMemo(
    () => (environmentId === null ? null : scopeThreadRef(environmentId, CONTROL_THREAD_ID)),
    [environmentId],
  );

  // Queued so a Strict Mode remount cannot type `btop` into the shell twice.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    startQueueRef.current = startQueueRef.current.then(async () => {
      if (!active) return;
      const started = await startBtop();
      if (active) setStatus(started ? "ready" : "failed");
    });
    return () => {
      active = false;
    };
  }, [ready]);

  const message =
    environmentId === null
      ? "No local server."
      : cwd !== null && keybindings !== null && !canOperate
        ? "This connection cannot control terminals."
        : status === "failed"
          ? "Could not start btop."
          : "Starting btop…";

  return (
    <div data-thread-terminal-drawer className="relative h-full w-full">
      {ready && status === "ready" && threadRef !== null ? (
        <TerminalViewport
          threadRef={threadRef}
          threadId={CONTROL_THREAD_ID}
          terminalId={BTOP_TERMINAL_ID}
          terminalLabel="btop"
          cwd={cwd}
          advancedTypography={advancedTypography}
          onSessionExited={noop}
          focusRequestId={0}
          autoFocus={false}
          visible
          // The terminal surface refits itself whenever this panel resizes.
          resizeEpoch={0}
          drawerHeight={0}
          keybindings={keybindings}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {message}
        </div>
      )}
    </div>
  );
}
