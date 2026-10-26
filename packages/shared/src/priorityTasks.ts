/**
 * Plain tasks on the Control window's priority list, shared by the web panel
 * and Slack's task commands so both read requests and order the list alike.
 *
 * @module priorityTasks
 */
import type { LinearTicket, PriorityTask, PriorityTaskPriority } from "@t3tools/contracts";

import { PRIORITY_RANK } from "./linearPriorities.ts";

/** How a task is named everywhere: on its card, in Slack, and in `/remove-task`. */
export const taskLabel = (number: number) => `T-${number}`;

const PRIORITY_PREFIX = /^\s*(urgent|high|medium|low)\s*:\s*/i;
const PRIORITIES: Record<string, PriorityTaskPriority> = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  low: "low",
};

/**
 * A task from Slack text: `high: Fix login | Users cannot sign in`. The
 * priority needs its colon, so "High CPU on the build box" stays a title;
 * without one it is medium. The first line is the title and later lines the
 * body; on one line, `|` starts the body. Null when there is no title.
 */
export function parseTaskRequest(
  text: string,
): Pick<PriorityTask, "title" | "body" | "priority"> | null {
  const prefix = PRIORITY_PREFIX.exec(text);
  const priority = (prefix && PRIORITIES[prefix[1]!.toLowerCase()]) || "medium";
  const [first = "", ...rest] = text
    .slice(prefix?.[0].length ?? 0)
    .trim()
    .split(/\r?\n/);
  const bar = first.indexOf("|");
  const title = (bar === -1 ? first : first.slice(0, bar)).trim();
  if (title.length === 0) return null;
  const body = [bar === -1 ? "" : first.slice(bar + 1), ...rest].join("\n").trim();
  return { title, body, priority };
}

const TASK_NUMBER_PATTERN = /(?<![\w-])(?:t-|#)?(\d{1,7})(?![\w-])/gi;

/** The task numbers named in `T-12, t-13 #14 15`, each once, in order. */
export function parseTaskNumbers(text: string): ReadonlyArray<number> {
  return [...new Set([...text.matchAll(TASK_NUMBER_PATTERN)].map((match) => Number(match[1])))];
}

export type PriorityItem<Ticket, Task> =
  | { readonly kind: "ticket"; readonly entry: Ticket }
  | { readonly kind: "task"; readonly task: Task };

/**
 * Tickets and tasks as one list, most urgent first; the one added earlier
 * breaks a tie. Tickets not loaded yet, or gone from Linear, sit at the bottom.
 */
export function orderPriorityItems<
  Ticket extends { readonly identifier: string; readonly addedAt: string },
  Task extends Pick<PriorityTask, "priority" | "createdAt">,
>(
  tickets: ReadonlyArray<Ticket>,
  tasks: ReadonlyArray<Task>,
  known: ReadonlyMap<string, Pick<LinearTicket, "priority">>,
): ReadonlyArray<PriorityItem<Ticket, Task>> {
  const ranked = [
    ...tickets.map((entry) => {
      const ticket = known.get(entry.identifier);
      return {
        item: { kind: "ticket", entry } as const,
        rank: ticket === undefined ? 5 : PRIORITY_RANK[ticket.priority],
        at: entry.addedAt,
      };
    }),
    ...tasks.map((task) => ({
      item: { kind: "task", task } as const,
      rank: PRIORITY_RANK[task.priority],
      at: task.createdAt,
    })),
  ];
  return ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        (left.at < right.at ? -1 : left.at > right.at ? 1 : 0) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
