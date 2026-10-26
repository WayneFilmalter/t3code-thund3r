import { describe, expect, it } from "vite-plus/test";

import { hasUnreadComments, isTicketDone } from "./priorities.logic";

describe("hasUnreadComments", () => {
  const at = (iso: string | null) => ({ latestOthersCommentAt: iso });
  it("is unread only when someone else commented after the last look", () => {
    expect(hasUnreadComments(at(null), { seenCommentsAt: null })).toBe(false);
    expect(hasUnreadComments(at("2026-10-21"), { seenCommentsAt: null })).toBe(true);
    expect(hasUnreadComments(at("2026-10-21"), { seenCommentsAt: "2026-10-21" })).toBe(false);
    expect(hasUnreadComments(at("2026-10-22"), { seenCommentsAt: "2026-10-21" })).toBe(true);
  });
});

describe("isTicketDone", () => {
  it("treats QA, QA Approved, Done and completed states as done", () => {
    expect(isTicketDone({ stateName: "QA", stateType: "started" })).toBe(true);
    expect(isTicketDone({ stateName: "QA Approved", stateType: "started" })).toBe(true);
    expect(isTicketDone({ stateName: "Done", stateType: "completed" })).toBe(true);
    expect(isTicketDone({ stateName: "Shipped", stateType: "completed" })).toBe(true);
    expect(isTicketDone({ stateName: "In Review", stateType: "started" })).toBe(false);
    expect(isTicketDone({ stateName: "Canceled", stateType: "canceled" })).toBe(false);
  });
});
