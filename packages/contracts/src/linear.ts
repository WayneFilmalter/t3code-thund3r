import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Linear issues read for the right panel's Linear tab. The server reaches
 * Linear through its hosted MCP server with the user's API key; no agent is
 * involved, so a fetch is a plain data request.
 */
export const LinearIssueStatus = Schema.Literals([
  "qa",
  "testflight",
  "in-review",
  "in-progress",
  "todo",
  "backlog",
]);
export type LinearIssueStatus = typeof LinearIssueStatus.Type;

/** Panel order, top to bottom, with the Linear workflow state each section lists. */
export const LINEAR_ISSUE_STATUSES: ReadonlyArray<{
  readonly id: LinearIssueStatus;
  readonly label: string;
  readonly linearState: string;
}> = [
  { id: "qa", label: "QA", linearState: "QA Approved" },
  { id: "testflight", label: "TestFlight", linearState: "Testflight" },
  { id: "in-review", label: "In Review", linearState: "In Review" },
  { id: "in-progress", label: "In Progress", linearState: "In Progress" },
  { id: "todo", label: "Todo", linearState: "Todo" },
  { id: "backlog", label: "Backlog", linearState: "Backlog" },
];

export const LinearIssuePriority = Schema.Literals(["urgent", "high", "medium", "low", "none"]);
export type LinearIssuePriority = typeof LinearIssuePriority.Type;

export const LinearIssue = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  priority: LinearIssuePriority,
  estimate: Schema.NullOr(Schema.Number),
  stateName: Schema.String,
  /** Linear's suggested git branch for the issue, when the API returned one. */
  branchName: Schema.NullOr(Schema.String),
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearIssuesListInput = Schema.Struct({ status: LinearIssueStatus });
export type LinearIssuesListInput = typeof LinearIssuesListInput.Type;

export const LinearIssuesListResult = Schema.Struct({
  status: LinearIssueStatus,
  issues: Schema.Array(LinearIssue),
  fetchedAt: Schema.String,
});
export type LinearIssuesListResult = typeof LinearIssuesListResult.Type;

export class LinearError extends Schema.TaggedError<LinearError>()("LinearError", {
  kind: Schema.Literals(["not-configured", "unreachable", "rejected", "invalid-response"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * Tickets for the Control window's Priorities panel. These come from Linear's
 * GraphQL API (same API key as the Linear tab) because the panel needs
 * comments, attachments and posting, which the hosted MCP results do not
 * describe reliably.
 */
export const LinearStateType = Schema.Literals([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "unknown",
]);
export type LinearStateType = typeof LinearStateType.Type;

export const LinearPullRequestState = Schema.Literals(["open", "draft", "merged", "closed"]);
export type LinearPullRequestState = typeof LinearPullRequestState.Type;

export const LinearTicket = Schema.Struct({
  ...LinearIssue.fields,
  stateType: LinearStateType,
  /** The workflow state's colour in Linear, as `#rrggbb`. */
  stateColor: Schema.String,
  /** The ticket's linked GitHub pull request, preferring an open one. */
  pullRequestUrl: Schema.NullOr(Schema.String),
  /**
   * That pull request's state, or null without one. Defaults when absent so a
   * newer client still reads tickets from a server built before the field.
   */
  pullRequestState: Schema.NullOr(LinearPullRequestState).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** When someone other than the API key's owner last commented. */
  latestOthersCommentAt: Schema.NullOr(Schema.String),
  /** The API key's owner is @-mentioned in the description or in someone else's comment. */
  mentionsViewer: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type LinearTicket = typeof LinearTicket.Type;

export const LinearTicketComment = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  authorName: Schema.String,
  authorAvatarUrl: Schema.NullOr(Schema.String),
  isViewer: Schema.Boolean,
});
export type LinearTicketComment = typeof LinearTicketComment.Type;

export const LinearTicketDetail = Schema.Struct({
  ...LinearTicket.fields,
  description: Schema.String,
  assigneeName: Schema.NullOr(Schema.String),
  /** Oldest first. */
  comments: Schema.Array(LinearTicketComment),
});
export type LinearTicketDetail = typeof LinearTicketDetail.Type;

/** `ENG-482`: an upper-case team key, a dash, the issue number. */
export const LINEAR_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;

const LinearIdentifier = Schema.String.check(Schema.isPattern(LINEAR_IDENTIFIER_PATTERN));

export const LinearTicketsGetInput = Schema.Struct({
  identifiers: Schema.Array(LinearIdentifier).check(Schema.isMaxLength(100)),
});
export type LinearTicketsGetInput = typeof LinearTicketsGetInput.Type;

export const LinearTicketsGetResult = Schema.Struct({
  tickets: Schema.Array(LinearTicket),
  /** Requested identifiers Linear has no issue for. */
  missing: Schema.Array(Schema.String),
});
export type LinearTicketsGetResult = typeof LinearTicketsGetResult.Type;

export const LinearTicketsSearchInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(200)),
});
export type LinearTicketsSearchInput = typeof LinearTicketsSearchInput.Type;

export const LinearTicketsSearchResult = Schema.Struct({ tickets: Schema.Array(LinearTicket) });
export type LinearTicketsSearchResult = typeof LinearTicketsSearchResult.Type;

export const LinearTicketDetailInput = Schema.Struct({ identifier: LinearIdentifier });
export type LinearTicketDetailInput = typeof LinearTicketDetailInput.Type;

export const LinearCommentCreateInput = Schema.Struct({
  /** Linear's issue UUID. */
  issueId: Schema.String,
  body: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)),
});
export type LinearCommentCreateInput = typeof LinearCommentCreateInput.Type;

export const LinearCommentCreateResult = Schema.Struct({ commentId: Schema.String });
export type LinearCommentCreateResult = typeof LinearCommentCreateResult.Type;

/**
 * The Control window's Pulse panel: how many of the workspace's tickets sit
 * in each board status, and how tickets moved between states since a
 * point in time (the client's local Monday). Counts are tickets, not points.
 */
export const LinearBoardStatsInput = Schema.Struct({ since: Schema.String });
export type LinearBoardStatsInput = typeof LinearBoardStatsInput.Type;

export const LinearBoardStatusCount = Schema.Struct({
  status: LinearIssueStatus,
  count: Schema.Number,
  /** The workflow state's colour in Linear, or null when no ticket is in it. */
  color: Schema.NullOr(Schema.String),
});
export type LinearBoardStatusCount = typeof LinearBoardStatusCount.Type;

export const LinearBoardMove = Schema.Struct({
  /** Linear state name the tickets left, or null when they were created into `to`. */
  from: Schema.NullOr(Schema.String),
  to: Schema.String,
  fromColor: Schema.NullOr(Schema.String),
  toColor: Schema.NullOr(Schema.String),
  count: Schema.Number,
});
export type LinearBoardMove = typeof LinearBoardMove.Type;

export const LinearBoardStatsResult = Schema.Struct({
  /** One entry per board status, in `LINEAR_ISSUE_STATUSES` order. */
  statuses: Schema.Array(LinearBoardStatusCount),
  /** Most moved first. */
  moves: Schema.Array(LinearBoardMove),
  fetchedAt: Schema.String,
});
export type LinearBoardStatsResult = typeof LinearBoardStatsResult.Type;
