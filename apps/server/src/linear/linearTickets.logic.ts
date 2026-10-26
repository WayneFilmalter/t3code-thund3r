import {
  LinearError,
  type LinearStateType,
  type LinearTicket,
  type LinearTicketComment,
  type LinearTicketDetail,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

import { readPriority } from "./linearIssues.logic.ts";

/**
 * Pure pieces of the Priorities panel's Linear GraphQL client: the query
 * text, the identifier filter, and the mapping from Linear's issue nodes to
 * contract tickets. Kept apart from the service so the mapping is testable
 * without HTTP.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readNodes = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  isRecord(value) && Array.isArray(value.nodes) ? value.nodes.filter(isRecord) : [];

/**
 * Fields every ticket query selects. The description and comment slice feed
 * the unread dot and the mention border; only those two flags leave the server.
 */
export const TICKET_FIELDS = `
  id identifier title url branchName priority estimate description
  state { name type color }
  attachments { nodes { url sourceType metadata } }
  comments(first: 50) { nodes { createdAt body user { isMe } } }
`;

/** Every ticket query asks who the key belongs to, so mentions can be matched. */
const VIEWER_FIELDS = "viewer { displayName }";

export const TICKETS_QUERY = `query PriorityTickets($filter: IssueFilter!) {
  ${VIEWER_FIELDS}
  issues(first: 100, filter: $filter) { nodes { ${TICKET_FIELDS} } }
}`;

export const SEARCH_QUERY = `query PrioritySearch($term: String!) {
  ${VIEWER_FIELDS}
  searchIssues(term: $term, first: 10) { nodes { ${TICKET_FIELDS} } }
}`;

export const DETAIL_QUERY = `query PriorityTicket($id: String!) {
  ${VIEWER_FIELDS}
  issue(id: $id) {
    ${TICKET_FIELDS}
    assignee { name displayName }
    thread: comments(first: 250) {
      nodes { id body createdAt user { name displayName avatarUrl isMe } botActor { name } }
    }
  }
}`;

export const COMMENT_MUTATION = `mutation PriorityComment($input: CommentCreateInput!) {
  commentCreate(input: $input) { success comment { id } }
}`;

/**
 * The `issues` filter for a set of `ENG-482` identifiers: one clause per team
 * key, matching that team's issue numbers, so any number of teams is one request.
 * Each clause is an explicit `and`: Linear ignores an `or` whose branches are
 * bare multi-field filters and returns every issue instead.
 */
export function identifierFilter(identifiers: ReadonlyArray<string>): Record<string, unknown> {
  const numbersByTeam = new Map<string, number[]>();
  for (const identifier of identifiers) {
    const dash = identifier.lastIndexOf("-");
    const team = identifier.slice(0, dash);
    const number = Number(identifier.slice(dash + 1));
    const numbers = numbersByTeam.get(team) ?? [];
    numbers.push(number);
    numbersByTeam.set(team, numbers);
  }
  return {
    or: [...numbersByTeam].map(([team, numbers]) => ({
      and: [{ team: { key: { eq: team } } }, { number: { in: numbers } }],
    })),
  };
}

const STATE_TYPES: ReadonlySet<string> = new Set<LinearStateType>([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);

const PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

/** Open beats draft beats merged beats closed: the request still worth opening wins. */
const PULL_REQUEST_RANK: Record<string, number> = { open: 0, draft: 1, merged: 2, closed: 3 };

/** The linked GitHub pull request most worth opening, from the issue's attachments. */
export function pickPullRequestUrl(attachments: unknown): string | null {
  let best: { url: string; rank: number } | null = null;
  for (const attachment of readNodes(attachments)) {
    const url = readString(attachment.url);
    if (url === null || !PULL_REQUEST_URL.test(url)) continue;
    const metadata = isRecord(attachment.metadata) ? attachment.metadata : {};
    const status = (readString(metadata.status) ?? readString(metadata.state) ?? "").toLowerCase();
    const rank = PULL_REQUEST_RANK[status] ?? 1;
    if (best === null || rank < best.rank) best = { url, rank };
  }
  return best?.url ?? null;
}

/** The newest comment written by someone other than the API key's owner. */
export function latestOthersCommentAt(comments: unknown): string | null {
  let latest: string | null = null;
  for (const comment of readNodes(comments)) {
    const user = isRecord(comment.user) ? comment.user : null;
    if (user?.isMe === true) continue;
    const createdAt = readString(comment.createdAt);
    if (createdAt !== null && (latest === null || createdAt > latest)) latest = createdAt;
  }
  return latest;
}

/** The key owner's handle from a query's `viewer`, which Linear's markdown writes as `@handle`. */
export const readViewerHandle = (viewer: unknown): string | null =>
  isRecord(viewer) ? readString(viewer.displayName) : null;

/** Whether markdown @-mentions `handle`; `@wayne` matches, `@waynes` and `wayne/branch` do not. */
export function mentionsHandle(markdown: string, handle: string): boolean {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w@])@${escaped}(?![\\w-])`, "i").test(markdown);
}

/** The description, or a comment by someone else, mentions the key's owner. */
export function ticketMentionsViewer(
  node: Record<string, unknown>,
  handle: string | null,
): boolean {
  if (handle === null) return false;
  if (mentionsHandle(readString(node.description) ?? "", handle)) return true;
  return readNodes(node.comments).some((comment) => {
    const user = isRecord(comment.user) ? comment.user : null;
    return user?.isMe !== true && mentionsHandle(readString(comment.body) ?? "", handle);
  });
}

/** A ticket from one GraphQL issue node, or null when the node lacks an identifier. */
export function mapTicket(node: unknown, viewerHandle: string | null = null): LinearTicket | null {
  if (!isRecord(node)) return null;
  const id = readString(node.id);
  const identifier = readString(node.identifier);
  if (id === null || identifier === null) return null;
  const state = isRecord(node.state) ? node.state : {};
  const stateType = readString(state.type);
  return {
    id,
    identifier,
    title: readString(node.title) ?? identifier,
    url: readString(node.url) ?? "",
    priority: readPriority(node.priority),
    estimate: readNumber(node.estimate),
    stateName: readString(state.name) ?? "",
    branchName: readString(node.branchName),
    stateType:
      stateType !== null && STATE_TYPES.has(stateType) ? (stateType as LinearStateType) : "unknown",
    stateColor: readString(state.color) ?? "#8a8f98",
    pullRequestUrl: pickPullRequestUrl(node.attachments),
    latestOthersCommentAt: latestOthersCommentAt(node.comments),
    mentionsViewer: ticketMentionsViewer(node, viewerHandle),
  };
}

export function mapTickets(
  nodes: unknown,
  viewerHandle: string | null = null,
): ReadonlyArray<LinearTicket> {
  return readNodes(nodes).flatMap((node) => mapTicket(node, viewerHandle) ?? []);
}

function mapComment(node: Record<string, unknown>): LinearTicketComment | null {
  const id = readString(node.id);
  const createdAt = readString(node.createdAt);
  if (id === null || createdAt === null) return null;
  const user = isRecord(node.user) ? node.user : null;
  const bot = isRecord(node.botActor) ? node.botActor : null;
  return {
    id,
    body: typeof node.body === "string" ? node.body : "",
    createdAt,
    authorName:
      readString(user?.displayName) ?? readString(user?.name) ?? readString(bot?.name) ?? "Linear",
    authorAvatarUrl: readString(user?.avatarUrl),
    isViewer: user?.isMe === true,
  };
}

/** The full ticket for the detail view; comments oldest first. */
export function mapTicketDetail(
  node: unknown,
  viewerHandle: string | null = null,
): LinearTicketDetail | null {
  const ticket = mapTicket(node, viewerHandle);
  if (ticket === null || !isRecord(node)) return null;
  const assignee = isRecord(node.assignee) ? node.assignee : null;
  const comments = readNodes(node.thread)
    .flatMap((comment) => mapComment(comment) ?? [])
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    ...ticket,
    description: typeof node.description === "string" ? node.description : "",
    assigneeName: readString(assignee?.displayName) ?? readString(assignee?.name),
    comments,
  };
}

/**
 * The `data` of a GraphQL response, or the LinearError its status and
 * `errors` describe. Linear answers bad keys with 400/401 and an
 * AUTHENTICATION_ERROR, and rate limits with 429 or RATELIMITED.
 */
export function readGraphqlData(
  status: number,
  body: unknown,
): Result.Result<Record<string, unknown>, LinearError> {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors.filter(isRecord) : [];
  const codes = errors.map((error) => {
    const extensions = isRecord(error.extensions) ? error.extensions : {};
    return `${readString(extensions.code) ?? ""} ${readString(extensions.type) ?? ""}`.toLowerCase();
  });
  const message = errors.map((error) => readString(error.message)).find((text) => text !== null);
  if (status === 401 || status === 403 || codes.some((code) => code.includes("authentication"))) {
    return Result.fail(
      new LinearError({
        kind: "rejected",
        detail: "Linear rejected the API key. Check it in Settings → Integrations.",
      }),
    );
  }
  if (status === 429 || codes.some((code) => code.includes("ratelimited"))) {
    return Result.fail(
      new LinearError({
        kind: "unreachable",
        detail: "Linear is rate limiting; try again shortly.",
      }),
    );
  }
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (errors.length > 0 || data === null) {
    return Result.fail(
      new LinearError({
        kind: status >= 500 ? "unreachable" : "invalid-response",
        detail: `Linear request failed: ${message ?? `HTTP ${status}`}`,
      }),
    );
  }
  return Result.succeed(data);
}
