import { describe, expect, it } from "vite-plus/test";

import { usageTone, usageWindowTitle } from "./SidebarClaudeUsage.logic";

describe("usageTone", () => {
  it("turns dark yellow above 70% and red above 89%", () => {
    expect(usageTone(0)).toBe("bg-success");
    expect(usageTone(70)).toBe("bg-success");
    expect(usageTone(71)).toBe("bg-warning");
    expect(usageTone(89)).toBe("bg-warning");
    expect(usageTone(90)).toBe("bg-destructive");
  });
});

describe("usageWindowTitle", () => {
  it("names the window with its span", () => {
    expect(
      usageWindowTitle({
        id: "five_hour",
        kind: "session",
        label: "Session",
        usedPercent: 4,
        windowDurationMins: 300,
      }),
    ).toBe("Session (5 hour)");
    expect(
      usageWindowTitle({
        id: "seven_day_fable",
        kind: "weekly",
        label: "Weekly · Fable",
        usedPercent: 36,
        windowDurationMins: 10080,
      }),
    ).toBe("Weekly Fable (7 day)");
  });

  it("keeps the bare label when the span is unknown", () => {
    expect(usageWindowTitle({ id: "x", kind: "other", label: "Extra", usedPercent: 1 })).toBe(
      "Extra",
    );
  });
});
