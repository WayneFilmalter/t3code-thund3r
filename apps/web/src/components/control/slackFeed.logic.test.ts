import type { LinearRecentComment, SlackFeedMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  feedItems,
  slackFeedChannels,
  slackMessageContext,
  slackMessagePlace,
  slackPreviewText,
} from "./slackFeed.logic";

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

describe("slackFeedChannels", () => {
  it("lists the busiest channels first, then the muted ones by name", () => {
    const channels = slackFeedChannels(
      [
        message({ channelId: "C1", channelName: "#general", ts: "1.0" }),
        message({ channelId: "C2", channelName: "#linear", ts: "2.0" }),
        message({ channelId: "C2", channelName: "#linear", ts: "3.0" }),
      ],
      { C9: "#sentry", C3: "#github" },
    );
    expect(channels.map((c) => [c.name, c.count, c.muted])).toEqual([
      ["#linear", 2, false],
      ["#general", 1, false],
      ["#github", 0, true],
      ["#sentry", 0, true],
    ]);
  });
});

describe("feedItems", () => {
  const comment = (id: string, createdAt: string): LinearRecentComment => ({
    id,
    body: "Looks good",
    createdAt,
    url: `https://linear.app/acme/issue/ENG-1#comment-${id}`,
    authorName: "Ada",
    issueId: "uuid-1",
    issueIdentifier: "ENG-1",
    issueTitle: "Checkout",
    issueUrl: "https://linear.app/acme/issue/ENG-1",
  });

  it("interleaves Slack messages and Linear comments, newest first", () => {
    // 1761400000 is 2025-10-25T13:46:40Z.
    const items = feedItems(
      [message({ ts: "1761400000.000100" }), message({ ts: "1761300000.000100" })],
      [comment("c1", "2025-10-25T00:00:00.000Z")],
    );
    expect(items.map((item) => item.key)).toEqual([
      "slack:C1:1761400000.000100",
      "linear:c1",
      "slack:C1:1761300000.000100",
    ]);
  });
});
