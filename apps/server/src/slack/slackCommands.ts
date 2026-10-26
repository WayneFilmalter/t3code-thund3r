/**
 * Slack slash commands for the Control window's priority list:
 * `/priorities` lists it, `/add-priority` and `/remove-priority` change it.
 * Anyone in the workspace who can see the app can run them; the answer is
 * shown only to them. The list is the one in the server's Linear settings,
 * so a change shows up in every open Priorities panel straight away.
 *
 * @module slack/slackCommands
 */
import type { LinearIssuePriority, LinearPriority, LinearTicket } from "@t3tools/contracts";
import {
  orderByPriority,
  parsePriorityPaste,
  priorityAdditions,
} from "@t3tools/shared/linearPriorities";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { LinearTickets } from "../linear/LinearTickets.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { escapeSlackText } from "./slackFeed.ts";

/** One slash command as Socket Mode delivers it. */
export interface SlackSlashCommand {
  readonly command: string;
  readonly text: string;
  /** Where the answer goes; Slack accepts it for 30 minutes. */
  readonly responseUrl: string;
}

export const readSlashCommand = (payload: unknown): SlackSlashCommand | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const { command, text, response_url: responseUrl } = payload as Record<string, unknown>;
  if (typeof command !== "string" || typeof responseUrl !== "string") return null;
  return { command, text: typeof text === "string" ? text : "", responseUrl };
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

const sentence = (label: string, identifiers: ReadonlyArray<string>) =>
  identifiers.length === 0 ? [] : [`${label} ${identifiers.join(", ")}.`];

/** The list as Slack mrkdwn, most urgent first. Without Linear it still names every ticket. */
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
  const lines = orderByPriority(
    identifiers.map((identifier) => ({ identifier })),
    known,
  ).map(({ identifier }) => {
    const ticket = known.get(identifier);
    return ticket === undefined ? `• ${identifier} _not found in Linear_` : ticketLine(ticket);
  });
  return [header, ...lines].join("\n");
};

const USAGE: Record<string, string> = {
  "/add-priority":
    "Name the tickets to add, like `/add-priority ENG-482 #490` or paste a Linear link.",
  "/remove-priority": "Name the tickets to remove, like `/remove-priority ENG-482`.",
};

/** Runs one command and answers in Slack mrkdwn. Unknown commands get a short note. */
export const runPriorityCommand = Effect.fn("slackCommands.runPriorityCommand")(function* (
  command: SlackSlashCommand,
) {
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
