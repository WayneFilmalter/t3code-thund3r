import type { LinearIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { estimateLabel, sectionState } from "./linearPanel.logic";

const issue: LinearIssue = {
  id: "1",
  identifier: "KRW-1",
  title: "Thing",
  url: "https://linear.app/krew/issue/KRW-1",
  priority: "high",
  estimate: 2,
  stateName: "Todo",
  branchName: null,
};

describe("sectionState", () => {
  it("stays idle until the section is armed", () => {
    expect(sectionState({ armed: false, isPending: false, error: null, issues: null })).toBe(
      "idle",
    );
  });

  it("loads, then errors, before the first result", () => {
    expect(sectionState({ armed: true, isPending: true, error: null, issues: null })).toBe(
      "loading",
    );
    expect(sectionState({ armed: true, isPending: false, error: "boom", issues: null })).toBe(
      "error",
    );
  });

  it("keeps results visible through a refresh or a failed refresh", () => {
    expect(sectionState({ armed: true, isPending: true, error: null, issues: [issue] })).toBe(
      "ready",
    );
    expect(sectionState({ armed: true, isPending: false, error: "boom", issues: [issue] })).toBe(
      "ready",
    );
    expect(sectionState({ armed: true, isPending: false, error: null, issues: [] })).toBe("empty");
  });
});

describe("estimateLabel", () => {
  it("pluralises points and hides missing estimates", () => {
    expect(estimateLabel(null)).toBeNull();
    expect(estimateLabel(1)).toBe("1 pt");
    expect(estimateLabel(3)).toBe("3 pts");
  });
});
