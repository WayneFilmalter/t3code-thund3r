import type { SlackFeedMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applySlackFeedEvent, initialSlackFeedState } from "./slackFeed.ts";

const message = (ts: string, text = "hi"): SlackFeedMessage => ({
  channelId: "C1",
  channelName: "#general",
  kind: "channel",
  isThreadReply: false,
  ts,
  threadTs: null,
  senderName: "Ana",
  text,
  permalink: null,
});

describe("applySlackFeedEvent", () => {
  it("keeps newest first, replaces edits in place and drops removals", () => {
    let state = applySlackFeedEvent(initialSlackFeedState(), {
      _tag: "snapshot",
      status: { ...initialSlackFeedState().status, state: "live" },
      messages: [message("3.0"), message("1.0")],
    });
    state = applySlackFeedEvent(state, { _tag: "upsert", message: message("2.0") });
    state = applySlackFeedEvent(state, { _tag: "upsert", message: message("4.0") });
    state = applySlackFeedEvent(state, { _tag: "upsert", message: message("3.0", "edited") });
    state = applySlackFeedEvent(state, { _tag: "remove", channelId: "C1", ts: "1.0" });
    expect(state.messages.map((m) => [m.ts, m.text])).toEqual([
      ["4.0", "hi"],
      ["3.0", "edited"],
      ["2.0", "hi"],
    ]);
    expect(state.status.state).toBe("live");
  });
});
