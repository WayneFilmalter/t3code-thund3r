import {
  LINEAR_ISSUE_STATUSES,
  LinearError,
  type LinearBoardMove,
  type LinearBoardStatusCount,
  type LinearPullRequestState,
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

/** The API key owner's tickets, for the Pulse panel's board counts and moves. */
const ASSIGNED_TO_VIEWER = { assignee: { isMe: { eq: true } } };

export const BOARD_PAGE_SIZE = 250;

export const BOARD_COUNTS_QUERY = `query PulseBoardCounts($filter: IssueFilter!, $after: String) {
  issues(first: ${BOARD_PAGE_SIZE}, after: $after, filter: $filter) {
    nodes { state { name color } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Fifty issues with fifty history entries each stays under Linear's complexity limit. */
export const BOARD_MOVES_PAGE_SIZE = 50;

export const BOARD_MOVES_QUERY = `query PulseBoardMoves($filter: IssueFilter!, $after: String) {
  issues(first: ${BOARD_MOVES_PAGE_SIZE}, after: $after, filter: $filter) {
    nodes {
      createdAt
      state { name color }
      history(first: 50) {
        nodes { createdAt fromState { name color } toState { name color } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function boardCountsFilter(): Record<string, unknown> {
  return {
    and: [
      ASSIGNED_TO_VIEWER,
      { state: { name: { in: LINEAR_ISSUE_STATUSES.map((status) => status.linearState) } } },
    ],
  };
}

export function boardMovesFilter(since: string): Record<string, unknown> {
  return { and: [ASSIGNED_TO_VIEWER, { updatedAt: { gte: since } }] };
}

/** One page of an `issues` connection: its nodes and the cursor for the next, if any. */
export function readIssuesPage(connection: unknown): {
  readonly nodes: ReadonlyArray<Record<string, unknown>>;
  readonly nextCursor: string | null;
} {
  const pageInfo = isRecord(connection) && isRecord(connection.pageInfo) ? connection.pageInfo : {};
  return {
    nodes: readNodes(connection),
    nextCursor: pageInfo.hasNextPage === true ? readString(pageInfo.endCursor) : null,
  };
}

const readState = (value: unknown): { name: string; color: string | null } | null => {
  if (!isRecord(value)) return null;
  const name = readString(value.name);
  return name === null ? null : { name, color: readString(value.color) };
};

/** Tickets per board status, in panel order. State names match case-insensitively. */
export function mapBoardCounts(
  nodes: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<LinearBoardStatusCount> {
  const byName = new Map<string, { count: number; color: string | null }>();
  for (const node of nodes) {
    const state = readState(node.state);
    if (state === null) continue;
    const key = state.name.toLowerCase();
    const entry = byName.get(key) ?? { count: 0, color: state.color };
    entry.count += 1;
    byName.set(key, entry);
  }
  return LINEAR_ISSUE_STATUSES.map((status) => {
    const entry = byName.get(status.linearState.toLowerCase());
    return { status: status.id, count: entry?.count ?? 0, color: entry?.color ?? null };
  });
}

/**
 * State changes since `since`, grouped by from and to, most moved first.
 * An issue created since then counts as a move from nothing into the state
 * it was created in: the first change's from state, or its current state
 * when it has not moved.
 */
export function mapBoardMoves(
  nodes: ReadonlyArray<Record<string, unknown>>,
  since: string,
): ReadonlyArray<LinearBoardMove> {
  const sinceMs = Date.parse(since);
  const after = (value: unknown) => {
    const text = readString(value);
    return text !== null && Date.parse(text) >= sinceMs;
  };
  const moves = new Map<string, LinearBoardMove & { count: number }>();
  const add = (
    from: { name: string; color: string | null } | null,
    to: { name: string; color: string | null },
  ) => {
    const key = `${from?.name ?? ""}\u0000${to.name}`;
    const move = moves.get(key) ?? {
      from: from?.name ?? null,
      to: to.name,
      fromColor: from?.color ?? null,
      toColor: to.color,
      count: 0,
    };
    move.count += 1;
    moves.set(key, move);
  };
  for (const issue of nodes) {
    const changes = readNodes(issue.history)
      .map((entry) => ({
        createdAt: readString(entry.createdAt) ?? "",
        from: readState(entry.fromState),
        to: readState(entry.toState),
      }))
      .filter((change) => change.to !== null)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    const first = changes[0];
    // Linear sometimes records creation as a change from no state; that entry counts below.
    if (after(issue.createdAt) && first?.from !== null) {
      const created = first?.from ?? readState(issue.state);
      if (created !== null) add(null, created);
    }
    for (const change of changes) {
      if (change.to !== null && after(change.createdAt)) add(change.from, change.to);
    }
  }
  return [...moves.values()].toSorted(
    (left, right) => right.count - left.count || left.to.localeCompare(right.to),
  );
}

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
const PULL_REQUEST_RANK: Record<LinearPullRequestState, number> = {
  open: 0,
  draft: 1,
  merged: 2,
  closed: 3,
};

/**
 * GitHub's state from a Linear attachment's metadata. Linear reports a draft
 * as `status: "open"` with `draft: true`; an unreadable status counts as open.
 */
function readPullRequestState(metadata: Record<string, unknown>): LinearPullRequestState {
  const status = (readString(metadata.status) ?? readString(metadata.state) ?? "").toLowerCase();
  if (status === "merged" || status === "closed" || status === "draft") return status;
  return metadata.draft === true ? "draft" : "open";
}

/** The linked GitHub pull request most worth opening, from the issue's attachments. */
export function pickPullRequest(
  attachments: unknown,
): { readonly url: string; readonly state: LinearPullRequestState } | null {
  let best: { url: string; state: LinearPullRequestState } | null = null;
  for (const attachment of readNodes(attachments)) {
    const url = readString(attachment.url);
    if (url === null || !PULL_REQUEST_URL.test(url)) continue;
    const state = readPullRequestState(isRecord(attachment.metadata) ? attachment.metadata : {});
    if (best === null || PULL_REQUEST_RANK[state] < PULL_REQUEST_RANK[best.state]) {
      best = { url, state };
    }
  }
  return best;
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
  const pullRequest = pickPullRequest(node.attachments);
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
    pullRequestUrl: pullRequest?.url ?? null,
    pullRequestState: pullRequest?.state ?? null,
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
