import { describe, expect, it } from "vite-plus/test";

import { orderByPriority, parsePriorityPaste, priorityAdditions } from "./linearPriorities.ts";

describe("parsePriorityPaste", () => {
  it("reads a priorities message with ids, links, #numbers and bare numbers in order", () => {
    const message = [
      "Morning team! The priorities for this week are:",
      "1. ENG-482 checkout times out on slow networks",
      "2. https://linear.app/acme/issue/ENG-490/onboarding-copy",
      "3. #501 — needs QA before Thursday 10:30",
      "- 512 and eng-77",
      "• OPS-9 (infra), plus 482 again",
      "Standup moved to 26 Oct, 3.5 hours blocked, 40% done, see https://github.com/acme/web/pull/1234",
    ].join("\n");

    expect(parsePriorityPaste(message, "ENG")).toEqual([
      "ENG-482",
      "ENG-490",
      "ENG-501",
      "ENG-512",
      "ENG-77",
      "OPS-9",
    ]);
  });

  it("accepts a number at the end of a sentence", () => {
    expect(parsePriorityPaste("Please pick up 482.", "ENG")).toEqual(["ENG-482"]);
  });

  it("ignores lower-case prefixes that are not the team's, and branch names", () => {
    expect(parsePriorityPaste("covid-19 and wayne/eng-482-checkout", "ENG")).toEqual([]);
  });

  it("skips bare and hash numbers without a team key", () => {
    expect(parsePriorityPaste("ENG-1, #2, 300", "")).toEqual(["ENG-1"]);
  });

  it("normalises leading zeros", () => {
    expect(parsePriorityPaste("ENG-0482 and #0482", "ENG")).toEqual(["ENG-482"]);
  });
});

describe("priorityAdditions", () => {
  it("adds new tickets in order, once, and counts existing comments as seen", () => {
    const additions = priorityAdditions(
      { "ENG-1": { addedAt: "t0", seenCommentsAt: null } },
      [
        { identifier: "ENG-2", latestOthersCommentAt: "2026-10-20T00:00:00.000Z" },
        { identifier: "ENG-1", latestOthersCommentAt: null },
        { identifier: "ENG-3", latestOthersCommentAt: null },
        { identifier: "ENG-2", latestOthersCommentAt: null },
      ],
      "t1",
    );
    expect(Object.entries(additions)).toEqual([
      ["ENG-2", { addedAt: "t1", seenCommentsAt: "2026-10-20T00:00:00.000Z" }],
      ["ENG-3", { addedAt: "t1", seenCommentsAt: null }],
    ]);
  });
});

describe("orderByPriority", () => {
  it("puts the most urgent first, keeps added order within a priority, and unloaded last", () => {
    const entries = ["A-1", "A-2", "A-3", "A-4", "A-5"].map((identifier) => ({ identifier }));
    const tickets = new Map([
      ["A-1", { priority: "low" as const }],
      ["A-2", { priority: "urgent" as const }],
      ["A-4", { priority: "none" as const }],
      ["A-5", { priority: "urgent" as const }],
    ]);
    expect(orderByPriority(entries, tickets).map((entry) => entry.identifier)).toEqual([
      "A-2",
      "A-5",
      "A-1",
      "A-4",
      "A-3",
    ]);
  });
});
