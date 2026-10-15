import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_BASE_PALETTE,
  AGENT_MAP_ACCENTS,
  agentBaseAccent,
  bubbleAccent,
} from "./agentMapColors";

describe("agent colours", () => {
  it("gives an agent a stable colour from the palette", () => {
    expect(agentBaseAccent("thread-1")).toBe(agentBaseAccent("thread-1"));
    expect(AGENT_BASE_PALETTE).toContain(agentBaseAccent("thread-1"));
    expect(AGENT_BASE_PALETTE).toContain(agentBaseAccent("sub-9"));
  });

  it("keeps the agent's own colour unless it failed or stalled", () => {
    expect(bubbleAccent({ id: "sub-1", status: "tool" })).toBe(agentBaseAccent("sub-1"));
    expect(bubbleAccent({ id: "sub-1", status: "done" })).toBe(agentBaseAccent("sub-1"));
    expect(bubbleAccent({ id: "sub-1", status: "failed" })).toBe(AGENT_MAP_ACCENTS.failed);
    expect(bubbleAccent({ id: "sub-1", status: "stalled" })).toBe(AGENT_MAP_ACCENTS.stalled);
  });
});
