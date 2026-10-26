import type { SlackFeedMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { slackMessageContext, slackMessagePlace, slackPreviewText } from "./slackFeed.logic";

const message = (overrides: Partial<SlackFeedMessage>): SlackFeedMessage => ({
  channelId: "C1",
  channelName: "#general",
  kind: "channel",
  isThreadReply: false,
  ts: "1.0",
  threadTs: null,
  senderName: "Ana",
  text: "hi",
  permalink: null,
  ...overrides,
});

describe("slack feed labels", () => {
  it("names the conversation kind and thread replies", () => {
    expect(slackMessageContext(message({}))).toBe("");
    expect(slackMessageContext(message({ kind: "dm" }))).toBe("Direct message");
    expect(slackMessageContext(message({ kind: "group_dm", isThreadReply: true }))).toBe(
      "Group DM · Thread reply",
    );
    expect(slackMessagePlace(message({ kind: "dm", channelName: "Ana" }))).toBeNull();
    expect(slackMessagePlace(message({}))).toBe("#general");
  });

  it("reads markdown links and emphasis as plain words", () => {
    expect(slackPreviewText("**ship** [the docs](https://x.dev) ~~now~~")).toBe(
      "ship the docs now",
    );
  });
});
