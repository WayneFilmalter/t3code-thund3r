import type { LinearIssue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLinearGitIndex,
  estimateLabel,
  resolveLinearGitPresence,
  sectionState,
} from "./linearPanel.logic";

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

describe("git presence", () => {
  const index = buildLinearGitIndex(
    [
      { name: "wayne/kre-1", isRemote: false },
      { name: "origin/wayne/kre-2", isRemote: true, remoteName: "origin" },
      { name: "Wayne/KRE-5", isRemote: false },
    ],
    [
      { headBranch: "wayne/kre-2", state: "open" },
      { headBranch: "wayne/kre-3", state: "closed" },
      { headBranch: "wayne/kre-3", state: "merged" },
      { headBranch: "wayne/kre-4", state: "closed" },
    ],
  );

  it("strips the remote prefix and matches case-insensitively", () => {
    expect(resolveLinearGitPresence("wayne/kre-1", index)).toBe("branch");
    expect(resolveLinearGitPresence("wayne/kre-5", index)).toBe("branch");
  });

  it("prefers the strongest pull request state and falls back to the branch", () => {
    expect(resolveLinearGitPresence("wayne/kre-2", index)).toBe("open");
    expect(resolveLinearGitPresence("wayne/kre-3", index)).toBe("merged");
    expect(resolveLinearGitPresence("wayne/kre-4", index)).toBe("closed");
    expect(resolveLinearGitPresence("wayne/kre-9", index)).toBe("none");
    expect(resolveLinearGitPresence(null, index)).toBe("none");
  });
});
