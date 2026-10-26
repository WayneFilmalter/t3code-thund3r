import { useAtomValue } from "@effect/atom-react";
import { AuthTerminalOperateScope, type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

import { usePrimaryEnvironmentId } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { terminalEnvironment } from "~/state/terminal";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * btop runs in a terminal keyed by this synthetic thread id. Terminals are
 * keyed by free-form thread id; the server validates only the cwd.
 */
export const CONTROL_THREAD_ID = ThreadId.make("control-window");
export const BTOP_TERMINAL_ID = "btop";

/**
 * The btop terminal on the primary environment, which is this machine's own
 * server on desktop. `start` kills any running shell (and btop with it) and
 * types `btop` into a fresh one; `stop` closes the terminal.
 */
export function useBtopSession() {
  const environmentId = usePrimaryEnvironmentId();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const restartTerminal = useAtomCommand(terminalEnvironment.restart, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const cwd = serverConfig?.cwd ?? null;

  const start = useCallback(async (): Promise<boolean> => {
    if (environmentId === null || cwd === null) return false;
    const restarted = await restartTerminal({
      environmentId,
      input: {
        threadId: CONTROL_THREAD_ID,
        terminalId: BTOP_TERMINAL_ID,
        cwd,
        // The panel's viewport resizes the PTY to fit once it attaches.
        cols: 80,
        rows: 24,
      },
    });
    if (restarted._tag !== "Success") return false;
    const wrote = await writeTerminal({
      environmentId,
      input: { threadId: CONTROL_THREAD_ID, terminalId: BTOP_TERMINAL_ID, data: "btop\r" },
    });
    return wrote._tag === "Success";
  }, [cwd, environmentId, restartTerminal, writeTerminal]);

  const stop = useCallback(
    async (targetEnvironmentId: EnvironmentId) => {
      await closeTerminal({
        environmentId: targetEnvironmentId,
        input: { threadId: CONTROL_THREAD_ID, terminalId: BTOP_TERMINAL_ID, deleteHistory: true },
      });
    },
    [closeTerminal],
  );

  return {
    environmentId,
    cwd,
    keybindings: serverConfig?.keybindings ?? null,
    canOperate,
    start,
    stop,
  };
}
