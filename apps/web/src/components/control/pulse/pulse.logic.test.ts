import { UsageDay } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentRows,
  compactTokens,
  localWeekStart,
  modelKey,
  promptDays,
  statusDeltas,
  toolCallPills,
  toolLabel,
} from "./pulse.logic";

const totals = (tokens: number) => ({
  uncachedInputTokens: tokens,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});

describe("localWeekStart", () => {
  it("is Monday midnight, including on Monday and Sunday", () => {
    expect(localWeekStart(new Date(2026, 9, 28, 15, 30))).toEqual(new Date(2026, 9, 26));
    expect(localWeekStart(new Date(2026, 9, 26, 0, 5))).toEqual(new Date(2026, 9, 26));
    expect(localWeekStart(new Date(2026, 10, 1, 23, 0))).toEqual(new Date(2026, 9, 26));
  });
});

describe("promptDays", () => {
  it("fills every day of the window, oldest first, across a month end", () => {
    const days = promptDays(
      [
        { day: "2026-10-31", count: 3, threads: 2 },
        { day: "2026-11-02", count: 5, threads: 4 },
        { day: "2026-10-01", count: 9, threads: 1 },
      ],
      new Date(2026, 10, 2, 12),
      4,
    );
    expect(days.map((entry) => [entry.day, entry.count, entry.threads])).toEqual([
      ["2026-10-30", 0, 0],
      ["2026-10-31", 3, 2],
      ["2026-11-01", 0, 0],
      ["2026-11-02", 5, 4],
    ]);
  });
});

describe("statusDeltas", () => {
  it("adds moves in, subtracts moves out, and ignores states off the board", () => {
    const deltas = statusDeltas([
      { from: "In Progress", to: "Todo", fromColor: null, toColor: null, count: 4 },
      { from: "In Review", to: "Done", fromColor: null, toColor: null, count: 2 },
      { from: null, to: "backlog", fromColor: null, toColor: null, count: 1 },
    ]);
    expect(Object.fromEntries(deltas)).toEqual({
      "in-progress": -4,
      todo: 4,
      "in-review": -2,
      backlog: 1,
    });
  });
});

describe("agentRows", () => {
  it("joins running agents with dated usage ids, busiest first", () => {
    const rows = agentRows(
      [
        { model: "claude-opus-5-5", provider: "claudeAgent", threads: 1, subagents: 2 },
        { model: "gpt-5.5", provider: "codex", threads: 1, subagents: 0 },
      ],
      [
        {
          day: UsageDay.make("2026-10-26"),
          provider: "claude",
          model: "claude-opus-5-5-20260901",
          totals: totals(100),
        },
        {
          day: UsageDay.make("2026-10-27"),
          provider: "claude",
          model: "claude-opus-5-5",
          totals: totals(50),
        },
        {
          day: UsageDay.make("2026-10-27"),
          provider: "claude",
          model: "claude-haiku-5-5",
          totals: totals(900),
        },
        {
          day: UsageDay.make("2026-10-27"),
          provider: "codex",
          model: "gpt-5.5",
          totals: totals(0),
        },
      ],
      "2026-10-27",
    );
    expect(rows.map((row) => [row.key, row.provider, row.threads + row.subagents])).toEqual([
      ["claude-opus-5-5", "claude", 3],
      ["gpt-5.5", "codex", 1],
      ["claude-haiku-5-5", "claude", 0],
    ]);
    expect(rows[0]).toMatchObject({ todayTokens: 50, weekTokens: 150, label: "Claude Opus 5.5" });
    expect(rows[2]).toMatchObject({ todayTokens: 900, weekTokens: 900 });
  });

  it("strips context-size suffixes when joining", () => {
    expect(modelKey("claude-opus-5-5[1m]")).toBe("claude-opus-5-5");
  });
});

describe("compactTokens", () => {
  it("shortens to a cell-sized label", () => {
    expect(compactTokens(845)).toBe("845");
    expect(compactTokens(1_000)).toBe("1k");
    expect(compactTokens(12_400)).toBe("12k");
    expect(compactTokens(1_250_000)).toBe("1.3M");
    expect(compactTokens(3_400_000_000)).toBe("3.4B");
  });
});

describe("toolLabel", () => {
  it("names built-in kinds, tools, and MCP servers by server", () => {
    expect(toolLabel("command_execution", null)).toBe("Shell");
    expect(toolLabel("dynamic_tool", "Read")).toBe("Read");
    expect(toolLabel("dynamic_tool", "mcp__t3-code__delegate_task")).toBe("T3-code");
    expect(toolLabel("dynamic_tool", "Linear MCP")).toBe("Linear");
    expect(toolLabel("dynamic_tool", null)).toBe("Other");
  });
});

describe("toolCallPills", () => {
  it("merges a server's spellings and folds the long tail into Other", () => {
    const result = toolCallPills(
      [
        { type: "command_execution", name: null, count: 20 },
        { type: "dynamic_tool", name: "Read", count: 8 },
        { type: "dynamic_tool", name: "Linear MCP", count: 4 },
        { type: "dynamic_tool", name: "linear", count: 3 },
        { type: "dynamic_tool", name: null, count: 1 },
        { type: "web_search", name: null, count: 2 },
        { type: "file_change", name: null, count: 1 },
      ],
      4,
    );
    expect(result).toEqual({
      total: 39,
      pills: [
        { label: "Shell", count: 20 },
        { label: "Read", count: 8 },
        { label: "Linear", count: 7 },
        { label: "Other", count: 4 },
      ],
    });
  });

  it("shows every pill when they fit", () => {
    expect(toolCallPills([{ type: "subagent", name: null, count: 2 }], 4)).toEqual({
      total: 2,
      pills: [{ label: "Subagent", count: 2 }],
    });
  });
});
