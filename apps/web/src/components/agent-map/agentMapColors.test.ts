import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_BASE_PALETTE,
  AGENT_MAP_ACCENTS,
  AGENT_MAP_CATEGORY_ACCENTS,
  bubbleAccent,
  childAccent,
  rootAccent,
} from "./agentMapColors";

describe("agent colours", () => {
  it("gives the main agent a stable colour from the palette", () => {
    expect(rootAccent("thread-1")).toBe(rootAccent("thread-1"));
    expect(AGENT_BASE_PALETTE).toContain(rootAccent("thread-1"));
  });

  it("never colours a subagent like the main agent, and siblings differ until the palette wraps", () => {
    for (const threadId of ["thread-1", "thread-2", "thread-3"]) {
      const root = rootAccent(threadId);
      const siblings = Array.from({ length: AGENT_BASE_PALETTE.length - 1 }, (_, index) =>
        childAccent(threadId, index),
      );
      expect(siblings).not.toContain(root);
      expect(new Set(siblings).size).toBe(siblings.length);
      expect(childAccent(threadId, siblings.length)).toBe(siblings[0]);
    }
  });

  it("keeps agent colours apart from task cell colours", () => {
    const taskAccents = new Set(Object.values(AGENT_MAP_CATEGORY_ACCENTS));
    for (const accent of AGENT_BASE_PALETTE) expect(taskAccents).not.toContain(accent);
  });

  it("keeps the agent's own colour unless it failed or stalled", () => {
    const accent = AGENT_BASE_PALETTE[0]!;
    expect(bubbleAccent({ accent, status: "tool" })).toBe(accent);
    expect(bubbleAccent({ accent, status: "done" })).toBe(accent);
    expect(bubbleAccent({ accent, status: "failed" })).toBe(AGENT_MAP_ACCENTS.failed);
    expect(bubbleAccent({ accent, status: "stalled" })).toBe(AGENT_MAP_ACCENTS.stalled);
  });
});
