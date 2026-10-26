/**
 * Slack requests for the Control window's priority list. Slash commands
 * (`/priorities`, `/add-priority`, `/remove-priority`) answer privately but
 * are lost when the server is off. Messages in #priorities (`add ENG-482`,
 * `remove ENG-482`, `list`) stay in Slack's history, so a restart catches up
 * on them and Thund3rBot answers in their thread. Both change the list in the
 * server's Linear settings, so every open Priorities panel updates at once.
 * `/add-task`, `/remove-task` and `/get-tasks` (or `add-task …` messages)
 * do the same for the list's plain tasks. `/eod` (or `eod`) runs the EOD
 * Auto Agent and answers with its final reply once it finishes.
 * `/get-help` (or `help`) lists every command.
 *
 * @module slack/slackCommands
 */
import {
  SLACK_MESSAGE_MAX_LENGTH,
  SLACK_SLASH_COMMANDS,
  type LinearIssuePriority,
  type LinearPriority,
  type LinearTicket,
  type PriorityTask,
} from "@t3tools/contracts";
import {
  PRIORITY_RANK,
  parsePriorityPaste,
  priorityAdditions,
} from "@t3tools/shared/linearPriorities";
import {
  orderPriorityItems,
  parseTaskNumbers,
  parseTaskRequest,
  taskLabel,
} from "@t3tools/shared/priorityTasks";
import { subagentResultForRun } from "@t3tools/provider-core/server/subagentProjection";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { LinearTickets } from "../linear/LinearTickets.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { escapeSlackText } from "./slackFeed.ts";

/** One slash command as Socket Mode delivers it. */
export interface SlackSlashCommand {
  readonly command: string;
  readonly text: string;
  /** Where the answer goes; Slack accepts it for 30 minutes. */
  readonly responseUrl: string;
}

/** A request: which command, and the text after it. */
export type PriorityRequest = Pick<SlackSlashCommand, "command" | "text">;

export const readSlashCommand = (payload: unknown): SlackSlashCommand | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const { command, text, response_url: responseUrl } = payload as Record<string, unknown>;
  if (typeof command !== "string" || typeof responseUrl !== "string") return null;
  return { command, text: typeof text === "string" ? text : "", responseUrl };
};

/** The channel whose messages are priority requests. */
export const PRIORITY_CHANNEL_NAME = "priorities";

const MESSAGE_VERBS: Record<string, string> = {
  add: "/add-priority",
  remove: "/remove-priority",
  list: "/priorities",
  "add-task": "/add-task",
  "remove-task": "/remove-task",
  "get-tasks": "/get-tasks",
  eod: "/eod",
  help: "/get-help",
};

/** Every slash command with what it does, then the #priorities message verbs. */
export const formatHelp = (): string =>
  [
    "*Commands*",
    ...SLACK_SLASH_COMMANDS.map(
      ({ command, description, usageHint }) =>
        `• \`${command}\` ${description}${usageHint === undefined ? "" : `, like \`${usageHint}\``}`,
    ),
    `In #${PRIORITY_CHANNEL_NAME}, start a message with ${Object.keys(MESSAGE_VERBS)
      .map((verb) => `\`${verb}\``)
      .join(", ")} instead.`,
  ].join("\n");

/**
 * The request in a #priorities message, or null for ordinary chat. Only
 * top-level messages from people count, so Thund3rBot's thread replies and
 * other apps' posts never trigger anything.
 */
export const readPriorityMessage = (
  message: unknown,
): (PriorityRequest & { ts: string }) | null => {
  if (typeof message !== "object" || message === null) return null;
  const {
    type,
    subtype,
    bot_id: botId,
    ts,
    thread_ts: threadTs,
    text,
  } = message as Record<string, unknown>;
  if (type !== "message" || subtype !== undefined || botId !== undefined) return null;
  if (typeof ts !== "string" || typeof text !== "string") return null;
  if (threadTs !== undefined && threadTs !== ts) return null;
  const match = /^\s*([\w-]+)(?![\w-])(.*)$/s.exec(text);
  const command = match === null ? undefined : MESSAGE_VERBS[match[1]!.toLowerCase()];
  return command === undefined ? null : { ts, command, text: match![2]!.trim() };
};

/** Slack timestamps (`seconds.micros`) in order, without float rounding. */
export const isSlackTsAfter = (ts: string, other: string): boolean => {
  const [seconds = "", micros = ""] = ts.split(".");
  const [otherSeconds = "", otherMicros = ""] = other.split(".");
  if (Number(seconds) !== Number(otherSeconds)) return Number(seconds) > Number(otherSeconds);
  return micros.padEnd(6, "0") > otherMicros.padEnd(6, "0");
};

/** More than a priority list ever holds; a runaway paste stops here. */
const MAX_TICKETS = 25;

const PRIORITY_LABELS: Record<LinearIssuePriority, string | null> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: null,
};

const ticketLink = (ticket: Pick<LinearTicket, "identifier" | "url">) =>
  `<${ticket.url}|${ticket.identifier}>`;

const ticketLine = (ticket: LinearTicket) =>
  [
    `• ${ticketLink(ticket)} ${escapeSlackText(ticket.title)}`,
    `_${escapeSlackText(ticket.stateName)}_`,
    PRIORITY_LABELS[ticket.priority],
  ]
    .filter((part) => part !== null)
    .join(" · ");

const PRIORITY_HEADERS: Record<LinearIssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

const ORDERED_PRIORITIES = (Object.keys(PRIORITY_RANK) as Array<LinearIssuePriority>).sort(
  (left, right) => PRIORITY_RANK[left] - PRIORITY_RANK[right],
);

/** `ENG-482 - Title`, linked to the ticket. */
const groupedTicketLine = (ticket: LinearTicket) =>
  `${ticketLink(ticket)} - ${escapeSlackText(ticket.title)}`;

/** A bold header per priority, urgent to none, each over its tickets in the order given. */
const groupedByPriority = (
  tickets: ReadonlyArray<LinearTicket>,
  line: (ticket: LinearTicket) => string,
): ReadonlyArray<string> =>
  ORDERED_PRIORITIES.flatMap((priority) => {
    const group = tickets.filter((ticket) => ticket.priority === priority);
    return group.length === 0 ? [] : [`*${PRIORITY_HEADERS[priority]}*`, ...group.map(line)];
  });

const sentence = (label: string, identifiers: ReadonlyArray<string>) =>
  identifiers.length === 0 ? [] : [`${label} ${identifiers.join(", ")}.`];

/** The list as Slack mrkdwn, grouped by priority. Without Linear it still names every ticket. */
export const formatPriorityList = (
  identifiers: ReadonlyArray<string>,
  tickets: ReadonlyArray<LinearTicket> | null,
): string => {
  if (identifiers.length === 0) {
    return "The priority list is empty. Add a ticket with `/add-priority ENG-482`.";
  }
  const header = `*Priorities* (${identifiers.length})`;
  if (tickets === null) {
    return [header, ...identifiers.map((id) => `• ${id}`), "_Could not reach Linear._"].join("\n");
  }
  const known = new Map(tickets.map((ticket) => [ticket.identifier, ticket]));
  const found = identifiers.flatMap((identifier) => known.get(identifier) ?? []);
  const missing = identifiers.filter((identifier) => !known.has(identifier));
  return [
    header,
    ...groupedByPriority(
      found,
      (ticket) => `${groupedTicketLine(ticket)} · _${escapeSlackText(ticket.stateName)}_`,
    ),
    ...(missing.length === 0 ? [] : ["*Not found in Linear*", ...missing]),
  ].join("\n");
};

/** `/eod` runs the Auto Agent with this title, matched case-insensitively. */
export const EOD_AGENT_TITLE = "EOD";

/** Slack takes a slash command's answers for 30 minutes; the agent gets most of that. */
const EOD_TIMEOUT = Duration.minutes(25);

/** An answer to send now and, for `/eod`, the one that follows when the agent finishes. */
export interface EodStart {
  readonly text: string;
  readonly followUp: Effect.Effect<string> | null;
}

/**
 * Runs the EOD Auto Agent as its ▶ button does. The follow-up waits for the
 * run to settle and reads the agent's final reply.
 */
export const startEodAgent = Effect.fn("slackCommands.startEodAgent")(
  function* () {
    const scheduledTasks = yield* ScheduledTaskService;
    const threadManagement = yield* ThreadManagementService;
    const agent = (yield* scheduledTasks.list()).tasks.find(
      (task) =>
        task.kind === "auto_agent" && task.title.toLowerCase() === EOD_AGENT_TITLE.toLowerCase(),
    );
    if (agent === undefined) {
      return {
        text: `Create an Auto Agent named *${EOD_AGENT_TITLE}* in the Control window. \`/eod\` runs it and answers with its reply.`,
        followUp: null,
      } satisfies EodStart;
    }
    // A bound thread queues the prompt behind its current run, so its latest run is not this one.
    if (agent.threadId !== null) {
      return {
        text: `The *${EOD_AGENT_TITLE}* Auto Agent sends to one thread. Set it to start a new thread each run.`,
        followUp: null,
      } satisfies EodStart;
    }
    const { task } = yield* scheduledTasks.runNow({ id: agent.id });
    const threadId = task.lastRunThreadId;
    if (task.lastRunStatus !== "succeeded" || threadId == null) {
      return {
        text: `The EOD agent could not start${task.lastRunError === null ? "." : `: ${task.lastRunError}`}`,
        followUp: null,
      } satisfies EodStart;
    }
    const followUp = Effect.gen(function* () {
      const waited = yield* threadManagement.waitForThread({
        projectId: task.projectId,
        threadId,
        timeoutMs: Duration.toMillis(EOD_TIMEOUT),
      });
      if (waited.run === null) return "The EOD agent did not start a turn.";
      if (waited.timedOut) return "The EOD agent is still working. Its answer will be in T3 Code.";
      const records = yield* threadManagement.getThreadRecords(
        threadId,
        ["messages", "turnItems"],
        {
          messageRoles: ["assistant"],
          messageRunIds: [waited.run.id],
          turnItemRunIds: [waited.run.id],
          turnItemTypes: ["assistant_message", "error"],
        },
      );
      const reply = subagentResultForRun(records, waited.run);
      // Without a message or error item, the text is the helper's placeholder, not the agent's.
      return reply.messageId === null && reply.turnItemId === null
        ? "The EOD agent finished without an answer."
        : reply.text.slice(0, SLACK_MESSAGE_MAX_LENGTH);
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(`Could not read the EOD agent's answer: ${error.message}`),
      ),
    );
    return { text: "Running the EOD agent. Its answer will follow here.", followUp };
  },
  Effect.catch((error) =>
    Effect.succeed<EodStart>({
      text: `Could not run the EOD agent: ${error.message}`,
      followUp: null,
    }),
  ),
);
const USAGE: Record<string, string> = {
  "/add-priority": "Name the tickets to add, like `ENG-482 #490` or a Linear link.",
  "/remove-priority": "Name the tickets to remove, like `ENG-482`.",
};

const TASK_USAGE =
  "Write the task, like `/add-task high: Fix login | Users cannot sign in`. The priority (urgent, high, medium, low) is optional; the text after `|`, or on later lines, is the description.";

/** One task as Slack mrkdwn. `{ago}` lets Slack show "3 days ago" in each reader's own time. */
const taskLine = (task: PriorityTask) => {
  const seconds = Math.floor(Date.parse(task.createdAt) / 1000);
  return [
    `• ${taskLabel(task.number)} *${escapeSlackText(task.title)}*`,
    PRIORITY_LABELS[task.priority],
    Number.isFinite(seconds) ? `<!date^${seconds}^{ago}|${task.createdAt}>` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

/** The tasks most urgent first, oldest first within a priority. */
export const formatTaskList = (tasks: ReadonlyArray<PriorityTask>): string => {
  if (tasks.length === 0) return `There are no tasks. ${TASK_USAGE}`;
  const ordered = orderPriorityItems([], tasks, new Map()).flatMap((item) =>
    item.kind === "task" ? [item.task] : [],
  );
  return [`*Tasks* (${tasks.length})`, ...ordered.map(taskLine)].join("\n");
};

const runTaskCommand = Effect.fn("slackCommands.runTaskCommand")(function* (
  command: PriorityRequest,
) {
  const settingsService = yield* ServerSettingsService;
  const items = (yield* settingsService.getSettings).priorityTasks;

  if (command.command === "/get-tasks") return formatTaskList(Object.values(items));

  if (command.command === "/remove-task") {
    const numbers = parseTaskNumbers(command.text);
    if (numbers.length === 0) return "Name the tasks to remove, like `/remove-task T-12`.";
    const entries = Object.entries(items);
    const removed = numbers.flatMap((number) => {
      const entry = entries.find(([, task]) => task.number === number);
      return entry === undefined ? [] : [entry];
    });
    if (removed.length > 0) {
      yield* settingsService.updateSettings({
        priorityTasks: Object.fromEntries(removed.map(([id]) => [id, null])),
      });
    }
    return [
      ...removed.map(
        ([, task]) => `Removed ${taskLabel(task.number)} ${escapeSlackText(task.title)}.`,
      ),
      ...sentence(
        "No task",
        numbers
          .filter((number) => !removed.some(([, task]) => task.number === number))
          .map(taskLabel),
      ),
    ].join("\n");
  }

  const request = parseTaskRequest(command.text);
  if (request === null) return TASK_USAGE;
  const id = yield* (yield* Crypto.Crypto).randomUUIDv4();
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const updated = yield* settingsService.updateSettings({
    priorityTasks: { [id]: { ...request, createdAt } },
  });
  const task = updated.priorityTasks[id];
  return task === undefined
    ? "Could not add the task."
    : `Added ${taskLabel(task.number)} *${escapeSlackText(task.title)}* · ${PRIORITY_LABELS[task.priority]}`;
});

const TASK_COMMANDS = new Set(["/add-task", "/remove-task", "/get-tasks"]);

/** Runs one command and answers in Slack mrkdwn. Unknown commands get a short note. */
export const runPriorityCommand = Effect.fn("slackCommands.runPriorityCommand")(function* (
  command: PriorityRequest,
) {
  if (TASK_COMMANDS.has(command.command)) return yield* runTaskCommand(command);
  if (command.command === "/get-help") return formatHelp();
  const settingsService = yield* ServerSettingsService;
  const linearTickets = yield* LinearTickets;
  const settings = yield* settingsService.getSettings;
  const priorities: Readonly<Record<string, LinearPriority>> = settings.linear.priorities;
  const listed = Object.keys(priorities);

  if (command.command === "/priorities") {
    const tickets = yield* linearTickets.getTickets({ identifiers: listed }).pipe(
      Effect.map((result) => result.tickets),
      Effect.orElseSucceed(() => null),
    );
    return formatPriorityList(listed, tickets);
  }

  const usage = USAGE[command.command];
  if (usage === undefined) return `T3 Code does not know ${command.command}.`;
  const identifiers = parsePriorityPaste(command.text, settings.linear.teamKey).slice(
    0,
    MAX_TICKETS,
  );
  if (identifiers.length === 0) return usage;

  if (command.command === "/remove-priority") {
    const removed = identifiers.filter((identifier) => identifier in priorities);
    if (removed.length > 0) {
      yield* settingsService.updateSettings({
        linear: { priorities: Object.fromEntries(removed.map((id) => [id, null])) },
      });
    }
    return [
      ...sentence("Removed", removed),
      ...sentence(
        "Not on the list:",
        identifiers.filter((id) => !removed.includes(id)),
      ),
    ].join("\n");
  }

  const result = yield* linearTickets.getTickets({ identifiers });
  const additions = priorityAdditions(
    priorities,
    result.tickets,
    DateTime.formatIso(yield* DateTime.now),
  );
  if (Object.keys(additions).length > 0) {
    yield* settingsService.updateSettings({ linear: { priorities: additions } });
  }
  const added = result.tickets.filter((ticket) => ticket.identifier in additions);
  return [
    ...(added.length === 0 ? [] : ["Added to the priority list:", ...added.map(ticketLine)]),
    ...sentence(
      "Already on the list:",
      result.tickets.filter((ticket) => !(ticket.identifier in additions)).map((t) => t.identifier),
    ),
    ...sentence("Linear has no", result.missing),
  ].join("\n");
});
