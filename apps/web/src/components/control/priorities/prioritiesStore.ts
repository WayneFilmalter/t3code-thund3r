import {
  type EnvironmentId,
  LinearPriority,
  type LinearTicket,
  type PriorityTask,
  type PriorityTaskInput,
} from "@t3tools/contracts";
import { priorityAdditions } from "@t3tools/shared/linearPriorities";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo } from "react";

import { getLocalStorageItem, removeLocalStorageItem } from "~/hooks/useLocalStorage";
import { randomUUID } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

export interface PriorityEntry extends LinearPriority {
  readonly identifier: string;
}

/** Where the list lived before it moved to the server; read once, then cleared. */
const LEGACY_STORAGE_KEY = "t3code:control:priorities:v1";
const LegacyEntries = Schema.Array(
  Schema.Struct({ identifier: Schema.String, ...LinearPriority.fields }),
);
const EMPTY: Readonly<Record<string, LinearPriority>> = {};
const NO_TASKS: Readonly<Record<string, PriorityTask>> = {};

/**
 * The priority list, kept in the server's settings so every window and
 * device, and Slack's `/add-priority`, share it. Changes arrive through the
 * settings stream, so an add anywhere shows up everywhere straight away.
 */
export function usePriorityList(environmentId: EnvironmentId) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const loaded = settings !== null;
  const priorities = settings?.linear.priorities ?? EMPTY;
  const entries = useMemo(
    (): ReadonlyArray<PriorityEntry> =>
      Object.entries(priorities).map(([identifier, priority]) => ({ identifier, ...priority })),
    [priorities],
  );

  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update priorities",
  });
  const patch = useCallback(
    (next: Record<string, LinearPriority | null>) =>
      updateSettings({ environmentId, input: { patch: { linear: { priorities: next } } } }),
    [environmentId, updateSettings],
  );

  useEffect(() => {
    if (!loaded) return;
    const legacy = getLocalStorageItem(LEGACY_STORAGE_KEY, LegacyEntries);
    if (legacy === null) return;
    const additions = Object.fromEntries(
      legacy
        .filter((entry) => !(entry.identifier in priorities))
        .map(({ identifier, ...priority }) => [identifier, priority]),
    );
    if (Object.keys(additions).length === 0) {
      removeLocalStorageItem(LEGACY_STORAGE_KEY);
      return;
    }
    void patch(additions).then((result) => {
      if (result._tag === "Success") removeLocalStorageItem(LEGACY_STORAGE_KEY);
    });
  }, [loaded, patch, priorities]);

  const add = useCallback(
    (tickets: ReadonlyArray<Pick<LinearTicket, "identifier" | "latestOthersCommentAt">>) => {
      const additions = priorityAdditions(priorities, tickets, new Date().toISOString());
      if (Object.keys(additions).length > 0) void patch(additions);
    },
    [patch, priorities],
  );

  const remove = useCallback((identifier: string) => void patch({ [identifier]: null }), [patch]);

  const markSeen = useCallback(
    (identifier: string, latestOthersCommentAt: string | null) => {
      const current = priorities[identifier];
      if (current === undefined || current.seenCommentsAt === latestOthersCommentAt) return;
      void patch({ [identifier]: { ...current, seenCommentsAt: latestOthersCommentAt } });
    },
    [patch, priorities],
  );

  return { entries, add, remove, markSeen };
}

export interface TaskEntry extends PriorityTask {
  readonly id: string;
}

/**
 * The list's plain tasks, in the same server settings as the tickets so
 * Slack's `/add-task` and every window share them. The server numbers new
 * tasks; `restore` brings a removed one back under its old number.
 */
export function usePriorityTasks(environmentId: EnvironmentId) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const items = settings?.priorityTasks ?? NO_TASKS;
  const tasks = useMemo(
    (): ReadonlyArray<TaskEntry> => Object.entries(items).map(([id, task]) => ({ id, ...task })),
    [items],
  );

  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update tasks",
  });
  const patch = useCallback(
    (next: Record<string, PriorityTaskInput | null>) =>
      updateSettings({ environmentId, input: { patch: { priorityTasks: next } } }),
    [environmentId, updateSettings],
  );

  const add = useCallback(
    (task: Pick<PriorityTask, "title" | "body" | "priority">) =>
      patch({ [randomUUID()]: { ...task, createdAt: new Date().toISOString() } }),
    [patch],
  );
  const remove = useCallback((id: string) => patch({ [id]: null }), [patch]);
  const restore = useCallback(({ id, ...task }: TaskEntry) => patch({ [id]: task }), [patch]);

  return { tasks, add, remove, restore };
}
