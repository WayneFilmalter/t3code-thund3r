import type { LinearIssue } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import {
  LinearPayloadError,
  extractToolPayload,
  parseLinearIssues,
  readPriority,
} from "./linearIssues.logic.ts";

describe("extractToolPayload", () => {
  it("prefers structured content over text", () => {
    assert.deepEqual(
      extractToolPayload({
        structuredContent: { issues: [] },
        content: [{ type: "text", text: "[1]" }],
      }),
      { issues: [] },
    );
  });

  it("parses the first text block as JSON", () => {
    assert.deepEqual(extractToolPayload({ content: [{ type: "text", text: '[{"a":1}]' }] }), [
      { a: 1 },
    ]);
  });

  it("fails on tool errors and on text that is not JSON", () => {
    assert.throws(
      () => extractToolPayload({ isError: true, content: [{ type: "text", text: "Nope" }] }),
      LinearPayloadError,
      "Nope",
    );
    assert.throws(
      () => extractToolPayload({ content: [{ type: "text", text: "not json" }] }),
      LinearPayloadError,
    );
    assert.throws(() => extractToolPayload({ content: [] }), LinearPayloadError);
  });
});

describe("parseLinearIssues", () => {
  const full = {
    id: "uuid-1",
    identifier: "KRW-12",
    title: "Fix login",
    url: "https://linear.app/krew/issue/KRW-12",
    priority: 2,
    estimate: 3,
    state: { name: "In Review" },
    gitBranchName: "wayne/krw-12-fix-login",
  };

  it("reads a bare array and an object wrapping the list", () => {
    const expected: LinearIssue = {
      id: "uuid-1",
      identifier: "KRW-12",
      title: "Fix login",
      url: "https://linear.app/krew/issue/KRW-12",
      priority: "high",
      estimate: 3,
      stateName: "In Review",
      branchName: "wayne/krw-12-fix-login",
    };
    assert.deepEqual(parseLinearIssues([full]), [expected]);
    assert.deepEqual(parseLinearIssues({ issues: [full] }), [expected]);
    assert.deepEqual(parseLinearIssues({ nodes: [full] }), [expected]);
  });

  it("accepts string states, priority labels, and missing optional fields", () => {
    const [issue] = parseLinearIssues([
      { identifier: "KRW-1", title: "Plain", status: "Backlog", priority: "Urgent" },
    ]);
    assert.deepEqual(issue, {
      id: "KRW-1",
      identifier: "KRW-1",
      title: "Plain",
      url: "",
      priority: "urgent",
      estimate: null,
      stateName: "Backlog",
      branchName: null,
    });
  });

  it("reads the hosted MCP shape: identifier in id, uuid, and value-wrapped numbers", () => {
    const [issue] = parseLinearIssues({
      issues: [
        {
          id: "KRE-1756",
          uuid: "d65d59f7-77d5-4a90-8b71-61a59a1c4ccd",
          title: "Autonomous Hangout Testing",
          priority: { value: 1, name: "Urgent" },
          estimate: { value: 3, name: "3 Points" },
          url: "https://linear.app/krew/issue/KRE-1756/autonomous-hangout-testing",
          gitBranchName: "wayne/kre-1756",
          status: "In Progress",
          statusType: "started",
        },
      ],
      hasNextPage: false,
      cursor: "abc",
    });
    assert.deepEqual(issue, {
      id: "d65d59f7-77d5-4a90-8b71-61a59a1c4ccd",
      identifier: "KRE-1756",
      title: "Autonomous Hangout Testing",
      url: "https://linear.app/krew/issue/KRE-1756/autonomous-hangout-testing",
      priority: "urgent",
      estimate: 3,
      stateName: "In Progress",
      branchName: "wayne/kre-1756",
    });
  });

  it("skips entries without an identifier and title", () => {
    assert.deepEqual(
      parseLinearIssues([
        { title: "No id" },
        { identifier: "KRE-2" },
        { id: "uuid", title: "x" },
        42,
      ]),
      [],
    );
  });

  it("fails when there is no list at all", () => {
    assert.throws(() => parseLinearIssues({ ok: true }), LinearPayloadError);
  });
});

describe("readPriority", () => {
  it("maps Linear's numbers and labels", () => {
    assert.equal(readPriority(0), "none");
    assert.equal(readPriority(1), "urgent");
    assert.equal(readPriority(4), "low");
    assert.equal(readPriority("Medium"), "medium");
    assert.equal(readPriority("No priority"), "none");
    assert.equal(readPriority({ value: 3 }), "medium");
    assert.equal(readPriority(undefined), "none");
  });
});
