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
