import type { LinearTicket } from "@t3tools/contracts";
import { useCallback } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { PriorityEntries, type PriorityEntry, appendPriorities } from "./priorities.logic";

const PRIORITIES_STORAGE_KEY = "t3code:control:priorities:v1";
const EMPTY: ReadonlyArray<PriorityEntry> = [];

/**
 * The priority list, kept in this browser's localStorage. The hook follows
 * writes from other windows, so tickets added in the main window's Control tab
 * appear in the Control window straight away.
 */
export function usePriorityList() {
  const [entries, setEntries] = useLocalStorage(PRIORITIES_STORAGE_KEY, EMPTY, PriorityEntries);

  const add = useCallback(
    (tickets: ReadonlyArray<Pick<LinearTicket, "identifier" | "latestOthersCommentAt">>) =>
      setEntries((current) => appendPriorities(current, tickets, new Date().toISOString())),
    [setEntries],
  );

  const remove = useCallback(
    (identifier: string) =>
      setEntries((current) => current.filter((entry) => entry.identifier !== identifier)),
    [setEntries],
  );

  const markSeen = useCallback(
    (identifier: string, latestOthersCommentAt: string | null) =>
      setEntries((current) =>
        current.some(
          (entry) =>
            entry.identifier === identifier && entry.seenCommentsAt !== latestOthersCommentAt,
        )
          ? current.map((entry) =>
              entry.identifier === identifier
                ? { ...entry, seenCommentsAt: latestOthersCommentAt }
                : entry,
            )
          : current,
      ),
    [setEntries],
  );

  return { entries, add, remove, markSeen };
}
