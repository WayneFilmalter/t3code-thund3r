import * as Result from "effect/Result";
import { assert, describe, it } from "vite-plus/test";

import {
  identifierFilter,
  mapBoardCounts,
  mapBoardMoves,
  mapRecentComments,
  readIssuesPage,
  latestOthersCommentAt,
  mapTicket,
  mapTicketDetail,
  mentionsHandle,
  pickPullRequest,
  readGraphqlData,
} from "./linearTickets.logic.ts";

const issueNode = {
  id: "uuid-1",
  identifier: "ENG-482",
  title: "Checkout times out on slow networks",
  url: "https://linear.app/acme/issue/ENG-482/checkout",
  branchName: "wayne/eng-482-checkout",
  priority: 1,
  estimate: 3,
  state: { name: "In Review", type: "started", color: "#0f783c" },
  attachments: {
    nodes: [
      {
        url: "https://github.com/acme/web/pull/10",
        sourceType: "github",
        metadata: { status: "merged" },
      },
      { url: "https://www.figma.com/file/abc", sourceType: "figma", metadata: {} },
      {
        url: "https://github.com/acme/web/pull/12",
        sourceType: "github",
        metadata: { status: "open" },
      },
    ],
  },
  comments: {
    nodes: [
      { createdAt: "2026-10-20T10:00:00.000Z", user: { isMe: false } },
      { createdAt: "2026-10-25T10:00:00.000Z", user: { isMe: true } },
      { createdAt: "2026-10-22T10:00:00.000Z", user: null },
    ],
  },
};

describe("identifierFilter", () => {
  it("groups issue numbers by team key into one filter", () => {
    assert.deepStrictEqual(identifierFilter(["ENG-1", "OPS-7", "ENG-22"]), {
      or: [
        { and: [{ team: { key: { eq: "ENG" } } }, { number: { in: [1, 22] } }] },
        { and: [{ team: { key: { eq: "OPS" } } }, { number: { in: [7] } }] },
      ],
    });
  });
});

describe("pickPullRequest", () => {
  it("prefers an open pull request over a merged one and ignores other links", () => {
    assert.deepStrictEqual(pickPullRequest(issueNode.attachments), {
      url: "https://github.com/acme/web/pull/12",
      state: "open",
    });
  });

  it("reads merged and Linear's draft flag", () => {
    const one = (metadata: unknown) =>
      pickPullRequest({ nodes: [{ url: "https://github.com/acme/web/pull/3", metadata }] })?.state;
    assert.strictEqual(one({ status: "merged" }), "merged");
    assert.strictEqual(one({ status: "open", draft: true }), "draft");
    assert.strictEqual(one({}), "open");
  });

  it("is null without a GitHub pull request", () => {
    assert.isNull(pickPullRequest({ nodes: [{ url: "https://github.com/acme/web/issues/3" }] }));
    assert.isNull(pickPullRequest(undefined));
  });
});

describe("latestOthersCommentAt", () => {
  it("skips the API key owner's own comments; bot comments count", () => {
    assert.strictEqual(latestOthersCommentAt(issueNode.comments), "2026-10-22T10:00:00.000Z");
  });

  it("is null when only the owner commented", () => {
    assert.isNull(
      latestOthersCommentAt({
        nodes: [{ createdAt: "2026-10-25T10:00:00.000Z", user: { isMe: true } }],
      }),
    );
  });
});

describe("mapTicket", () => {
  it("maps a GraphQL issue node to a ticket", () => {
    assert.deepStrictEqual(mapTicket(issueNode), {
      id: "uuid-1",
      identifier: "ENG-482",
      title: "Checkout times out on slow networks",
      url: "https://linear.app/acme/issue/ENG-482/checkout",
      priority: "urgent",
      estimate: 3,
      stateName: "In Review",
      branchName: "wayne/eng-482-checkout",
      stateType: "started",
      stateColor: "#0f783c",
      pullRequestUrl: "https://github.com/acme/web/pull/12",
      pullRequestState: "open",
      latestOthersCommentAt: "2026-10-22T10:00:00.000Z",
      mentionsViewer: false,
    });
  });

  it("flags a mention of the viewer in the description or someone else's comment", () => {
    const comment = (body: string, isMe: boolean) => ({
      createdAt: "2026-10-22T10:00:00.000Z",
      body,
      user: { isMe },
    });
    const withComments = (...nodes: ReturnType<typeof comment>[]) => ({
      ...issueNode,
      comments: { nodes },
    });
    assert.isTrue(
      mapTicket(withComments(comment("@wayne can you look?", false)), "wayne")?.mentionsViewer,
    );
    assert.isTrue(mapTicket({ ...issueNode, description: "cc @Wayne" }, "wayne")?.mentionsViewer);
    // Your own comment, someone else's handle, or no known viewer is not a mention.
    assert.isFalse(
      mapTicket(withComments(comment("note to self @wayne", true)), "wayne")?.mentionsViewer,
    );
    assert.isFalse(mapTicket(withComments(comment("@wayne", false)), null)?.mentionsViewer);
  });

  it("reads an unfamiliar state type as unknown and skips nodes without an identifier", () => {
    assert.strictEqual(
      mapTicket({ ...issueNode, state: { type: "paused" } })?.stateType,
      "unknown",
    );
    assert.isNull(mapTicket({ id: "uuid-2", title: "No identifier" }));
  });
});

describe("mentionsHandle", () => {
  it("matches the whole handle only", () => {
    assert.isTrue(mentionsHandle("@wayne said", "wayne"));
    assert.isTrue(mentionsHandle("thanks, @wayne.", "wayne"));
    assert.isFalse(mentionsHandle("@waynes said", "wayne"));
    assert.isFalse(mentionsHandle("branch wayne/kre-1301", "wayne"));
    assert.isFalse(mentionsHandle("mail me@wayne.dev", "wayne"));
    assert.isTrue(mentionsHandle("@j.doe ping", "j.doe"));
  });
});

describe("mapTicketDetail", () => {
  it("adds the description, assignee and comments oldest first", () => {
    const detail = mapTicketDetail({
      ...issueNode,
      description: "Repro: throttle to 3G.",
      assignee: { name: "wayne", displayName: "Wayne" },
      thread: {
        nodes: [
          {
            id: "c2",
            body: "On it",
            createdAt: "2026-10-25T10:00:00.000Z",
            user: { name: "wayne", displayName: "Wayne", avatarUrl: null, isMe: true },
          },
          {
            id: "c1",
            body: "Seeing this in prod",
            createdAt: "2026-10-20T10:00:00.000Z",
            user: { name: "mike", displayName: "Mike", avatarUrl: "https://a/m.png", isMe: false },
          },
          {
            id: "c3",
            body: "Linked PR",
            createdAt: "2026-10-26T10:00:00.000Z",
            botActor: { name: "GitHub" },
          },
        ],
      },
    });
    assert.strictEqual(detail?.description, "Repro: throttle to 3G.");
    assert.strictEqual(detail?.assigneeName, "Wayne");
    assert.deepStrictEqual(
      detail?.comments.map((comment) => [comment.id, comment.authorName, comment.isViewer]),
      [
        ["c1", "Mike", false],
        ["c2", "Wayne", true],
        ["c3", "GitHub", false],
      ],
    );
  });
});

describe("readGraphqlData", () => {
  const failure = (status: number, body: unknown) => {
    const result = readGraphqlData(status, body);
    assert.isTrue(Result.isFailure(result));
    return Result.isFailure(result) ? result.failure : null;
  };

  it("returns data from a clean response", () => {
    assert.deepStrictEqual(
      readGraphqlData(200, { data: { issue: null } }),
      Result.succeed({ issue: null }),
    );
  });

  it("treats an authentication error as a rejected key", () => {
    const error = failure(400, {
      errors: [
        { message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } },
      ],
    });
    assert.strictEqual(error?.kind, "rejected");
  });

  it("treats rate limiting and server errors as unreachable", () => {
    assert.strictEqual(failure(429, null)?.kind, "unreachable");
    assert.strictEqual(failure(502, null)?.kind, "unreachable");
  });

  it("surfaces other GraphQL errors with Linear's message", () => {
    const error = failure(200, {
      data: null,
      errors: [{ message: "Entity not found: Issue", extensions: { type: "invalid input" } }],
    });
    assert.strictEqual(error?.kind, "invalid-response");
    assert.include(error?.detail, "Entity not found");
  });
});

describe("board stats", () => {
  const since = "2026-10-26T04:00:00.000Z";
  const state = (name: string, color = "#111111") => ({ name, color });

  it("counts tickets per board status in panel order, matching names loosely", () => {
    const statuses = mapBoardCounts([
      { state: state("In Review", "#0f783c") },
      { state: state("in review") },
      { state: state("Backlog", "#bec2c8") },
      { state: state("Done") },
      { state: null },
    ]);
    assert.deepStrictEqual(
      statuses.map((entry) => entry.status),
      ["qa", "testflight", "in-review", "in-progress", "todo", "backlog"],
    );
    assert.deepStrictEqual(statuses[2], { status: "in-review", count: 2, color: "#0f783c" });
    assert.deepStrictEqual(statuses[5], { status: "backlog", count: 1, color: "#bec2c8" });
    assert.deepStrictEqual(statuses[0], { status: "qa", count: 0, color: null });
  });

  it("groups state changes since the cutoff, most moved first", () => {
    const change = (createdAt: string, from: string | null, to: string | null) => ({
      createdAt,
      fromState: from === null ? null : state(from),
      toState: to === null ? null : state(to),
    });
    const moves = mapBoardMoves(
      [
        {
          createdAt: "2026-09-01T00:00:00.000Z",
          state: state("Todo"),
          history: {
            nodes: [
              change("2026-10-27T10:00:00.000Z", "In Progress", "Todo"),
              change("2026-10-20T10:00:00.000Z", "Todo", "In Progress"),
              change("2026-10-27T11:00:00.000Z", null, null),
            ],
          },
        },
        {
          createdAt: "2026-09-01T00:00:00.000Z",
          state: state("Todo"),
          history: { nodes: [change("2026-10-26T09:00:00.000Z", "In Progress", "Todo")] },
        },
        {
          createdAt: "2026-09-02T00:00:00.000Z",
          state: state("Done"),
          history: { nodes: [change("2026-10-28T09:00:00.000Z", "In Review", "Done")] },
        },
      ],
      since,
    );
    assert.deepStrictEqual(
      moves.map((move) => [move.from, move.to, move.count]),
      [
        ["In Progress", "Todo", 2],
        ["In Review", "Done", 1],
      ],
    );
  });

  it("counts a ticket created since the cutoff as entering its first state", () => {
    const moves = mapBoardMoves(
      [
        {
          createdAt: "2026-10-27T08:00:00.000Z",
          state: state("In Progress"),
          history: {
            nodes: [
              {
                createdAt: "2026-10-27T09:00:00.000Z",
                fromState: state("Backlog"),
                toState: state("In Progress"),
              },
            ],
          },
        },
        { createdAt: "2026-10-27T08:00:00.000Z", state: state("Backlog"), history: { nodes: [] } },
      ],
      since,
    );
    assert.deepStrictEqual(
      moves.map((move) => [move.from, move.to, move.count]),
      [
        [null, "Backlog", 2],
        ["Backlog", "In Progress", 1],
      ],
    );
  });

  it("reads the next page cursor only while Linear has more", () => {
    assert.deepStrictEqual(
      readIssuesPage({ nodes: [{}], pageInfo: { hasNextPage: true, endCursor: "abc" } }),
      { nodes: [{}], nextCursor: "abc" },
    );
    assert.strictEqual(
      readIssuesPage({ nodes: [], pageInfo: { hasNextPage: false, endCursor: "abc" } }).nextCursor,
      null,
    );
  });
});

describe("mapRecentComments", () => {
  const issue = {
    id: "uuid-1",
    identifier: "ENG-482",
    title: "Checkout times out",
    url: "https://linear.app/acme/issue/ENG-482",
  };

  it("keeps other people's issue comments, newest first", () => {
    const comments = mapRecentComments([
      {
        id: "c1",
        body: "Older",
        createdAt: "2026-10-24T08:00:00.000Z",
        url: "https://linear.app/acme/issue/ENG-482#comment-c1",
        user: { displayName: "ada", name: "Ada Lovelace", isMe: false },
        issue,
      },
      {
        id: "c2",
        body: "Newer",
        createdAt: "2026-10-25T08:00:00.000Z",
        botActor: { name: "GitHub" },
        issue,
      },
    ]);
    assert.deepStrictEqual(
      comments.map((comment) => [comment.id, comment.authorName, comment.url]),
      [
        ["c2", "GitHub", issue.url],
        ["c1", "ada", "https://linear.app/acme/issue/ENG-482#comment-c1"],
      ],
    );
    assert.strictEqual(comments[0]?.issueIdentifier, "ENG-482");
  });

  it("drops the viewer's own comments and comments not on an issue", () => {
    const comments = mapRecentComments([
      {
        id: "mine",
        body: "Mine",
        createdAt: "2026-10-25T08:00:00.000Z",
        user: { name: "Me", isMe: true },
        issue,
      },
      {
        id: "project-update",
        body: "Not an issue",
        createdAt: "2026-10-25T09:00:00.000Z",
        user: { name: "Ada", isMe: false },
        issue: null,
      },
    ]);
    assert.deepStrictEqual(comments, []);
  });
});
