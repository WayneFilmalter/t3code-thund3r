import type { LinearTicket } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** One ticket on the local priority list. Linear owns everything else about it. */
export const PriorityEntry = Schema.Struct({
  identifier: Schema.String,
  addedAt: Schema.String,
  /** The newest comment by someone else when the ticket was last looked at. */
  seenCommentsAt: Schema.NullOr(Schema.String),
});
export type PriorityEntry = typeof PriorityEntry.Type;

export const PriorityEntries = Schema.Array(PriorityEntry);

/**
 * Appends tickets not already on the list, in the order given, so a pasted
 * list keeps its order. Comments that already exist count as seen.
 */
export function appendPriorities(
  entries: ReadonlyArray<PriorityEntry>,
  tickets: ReadonlyArray<Pick<LinearTicket, "identifier" | "latestOthersCommentAt">>,
  addedAt: string,
): ReadonlyArray<PriorityEntry> {
  const present = new Set(entries.map((entry) => entry.identifier));
  const additions: PriorityEntry[] = [];
  for (const ticket of tickets) {
    if (present.has(ticket.identifier)) continue;
    present.add(ticket.identifier);
    additions.push({
      identifier: ticket.identifier,
      addedAt,
      seenCommentsAt: ticket.latestOthersCommentAt,
    });
  }
  return additions.length === 0 ? entries : [...entries, ...additions];
}

/** Someone else has commented since the ticket was last opened. */
export function hasUnreadComments(
  ticket: Pick<LinearTicket, "latestOthersCommentAt">,
  entry: Pick<PriorityEntry, "seenCommentsAt">,
): boolean {
  const latest = ticket.latestOthersCommentAt;
  if (latest === null) return false;
  return entry.seenCommentsAt === null || latest > entry.seenCommentsAt;
}

const PRIORITY_RANK: Record<LinearTicket["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/**
 * Most urgent first; the order they were added breaks ties. Tickets not
 * loaded yet, or gone from Linear, sit at the bottom.
 */
export function orderByPriority<T extends Pick<PriorityEntry, "identifier">>(
  entries: ReadonlyArray<T>,
  tickets: ReadonlyMap<string, Pick<LinearTicket, "priority">>,
): ReadonlyArray<T> {
  const rank = (entry: T) => {
    const ticket = tickets.get(entry.identifier);
    return ticket === undefined ? 5 : PRIORITY_RANK[ticket.priority];
  };
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ entry }) => entry);
}

const DONE_STATE_NAMES = new Set(["qa", "qa approved", "done"]);

/** QA, QA Approved and Done leave the list without asking; so does any completed state. */
export function isTicketDone(ticket: Pick<LinearTicket, "stateName" | "stateType">): boolean {
  return (
    ticket.stateType === "completed" || DONE_STATE_NAMES.has(ticket.stateName.trim().toLowerCase())
  );
}

const MONTHS =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const URL_PATTERN = /https?:\/\/\S+/gi;
const LINEAR_URL_PATTERN = /linear\.app\/[^\s/]+\/issue\/([a-z][a-z0-9]{0,9}-\d{1,7})/gi;
const IDENTIFIER_PATTERN = /(?<![\w-])([a-z][a-z0-9]{0,9})-(\d{1,7})(?![\w-])/gi;
const HASH_NUMBER_PATTERN = /(?<![\w&])#(\d{1,7})(?!\w)/g;
/** A list marker at the start of a line: `-`, `*`, `•`, `1.`, `2)`. */
const LIST_MARKER_PATTERN = /^(\s*)(?:[-*•–]|\d{1,3}[.)])(?=\s)/gm;
/**
 * A standalone number: nothing word-like, a separator, or a currency sign
 * before it, and no unit, separator, or decimal after it, so `10:30`, `26/10`,
 * `3.5`, `40%` and `v2` are skipped while `482.` at the end of a sentence is not.
 */
const BARE_NUMBER_PATTERN = /(?<![\w:/.%$#-])(\d{2,6})(?![\w:/%-]|[.,]\d)/g;
const DATE_NEIGHBOUR_PATTERN = new RegExp(
  `(?:\\b(?:${MONTHS})\\.?\\s+$)|(?:^\\s*(?:${MONTHS})\\b)`,
  "i",
);

/** Replaces a match with spaces so later patterns cannot reuse it and offsets stay put. */
const blank = (text: string, start: number, length: number) =>
  text.slice(0, start) + " ".repeat(length) + text.slice(start + length);

/**
 * The Linear identifiers in a pasted message, in the order they appear, each
 * once. Reads Linear links, `ENG-482` (upper-case, or the team's own key in
 * any case), `#482`, and bare issue numbers, which take the configured team
 * key. Other links, times, dates, decimals, percentages and list numbering
 * are ignored; whatever slips through is caught by the confirm step, which
 * shows what Linear could not find.
 */
export function parsePriorityPaste(text: string, teamKey: string): ReadonlyArray<string> {
  const team = teamKey.trim().toUpperCase();
  const found: Array<{ index: number; identifier: string }> = [];
  let rest = text;

  for (const match of text.matchAll(URL_PATTERN)) {
    for (const linear of match[0].matchAll(LINEAR_URL_PATTERN)) {
      found.push({ index: match.index, identifier: linear[1]!.toUpperCase() });
    }
    rest = blank(rest, match.index, match[0].length);
  }

  for (const match of rest.matchAll(IDENTIFIER_PATTERN)) {
    const prefix = match[1]!;
    if (prefix !== prefix.toUpperCase() && prefix.toUpperCase() !== team) continue;
    found.push({ index: match.index, identifier: `${prefix.toUpperCase()}-${Number(match[2])}` });
    rest = blank(rest, match.index, match[0].length);
  }

  if (team.length > 0) {
    for (const match of rest.matchAll(HASH_NUMBER_PATTERN)) {
      found.push({ index: match.index, identifier: `${team}-${Number(match[1])}` });
      rest = blank(rest, match.index, match[0].length);
    }
    rest = rest.replace(LIST_MARKER_PATTERN, (marker, indent: string) =>
      indent.padEnd(marker.length, " "),
    );
    for (const match of rest.matchAll(BARE_NUMBER_PATTERN)) {
      const before = rest.slice(Math.max(0, match.index - 12), match.index);
      const after = rest.slice(match.index + match[0].length, match.index + match[0].length + 12);
      if (DATE_NEIGHBOUR_PATTERN.test(before) || DATE_NEIGHBOUR_PATTERN.test(after)) continue;
      found.push({ index: match.index, identifier: `${team}-${Number(match[1])}` });
    }
  }

  const seen = new Set<string>();
  return found
    .toSorted((left, right) => left.index - right.index)
    .flatMap(({ identifier }) => {
      if (seen.has(identifier)) return [];
      seen.add(identifier);
      return [identifier];
    });
}
