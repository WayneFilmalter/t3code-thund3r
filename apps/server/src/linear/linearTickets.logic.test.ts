import * as Result from "effect/Result";
import { assert, describe, it } from "vite-plus/test";

import {
  identifierFilter,
  latestOthersCommentAt,
  mapTicket,
  mapTicketDetail,
  mentionsHandle,
  pickPullRequestUrl,
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

describe("pickPullRequestUrl", () => {
  it("prefers an open pull request over a merged one and ignores other links", () => {
    assert.strictEqual(
      pickPullRequestUrl(issueNode.attachments),
      "https://github.com/acme/web/pull/12",
    );
  });

  it("is null without a GitHub pull request", () => {
    assert.isNull(pickPullRequestUrl({ nodes: [{ url: "https://github.com/acme/web/issues/3" }] }));
    assert.isNull(pickPullRequestUrl(undefined));
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
