import { slackReplyThreadTs, type SlackFeedMessage } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import {
  buildPermalink,
  feedChangeFromEvent,
  groupDmName,
  mentionedUserIds,
  rawFromSearchMatch,
  SLACK_FEED_WINDOW_MS,
  slackMrkdwnToMarkdown,
  windowFeed,
} from "./slackFeed.ts";

const SELF = "USELF";

const message = (overrides: Partial<SlackFeedMessage>): SlackFeedMessage => ({
  channelId: "C1",
  channelName: "#general",
  kind: "channel",
  isThreadReply: false,
  ts: "1700000000.000100",
  threadTs: null,
  senderName: "Ana",
  text: "hi",
  permalink: null,
  ...overrides,
});

describe("feedChangeFromEvent", () => {
  it("classifies conversations by channel type and keeps thread replies apart", () => {
    const dm = feedChangeFromEvent(
      { type: "message", channel: "D1", channel_type: "im", user: "U1", text: "yo", ts: "2.0" },
      SELF,
    );
    assert.deepInclude(dm, { _tag: "upsert" });
    assert.equal(dm?._tag === "upsert" && dm.message.kind, "dm");

    const reply = feedChangeFromEvent(
      {
        type: "message",
        channel: "C1",
        channel_type: "channel",
        user: "U1",
        text: "in thread",
        ts: "3.0",
        thread_ts: "1.0",
      },
      SELF,
    );
    assert.equal(reply?._tag === "upsert" && reply.message.threadTs, "1.0");

    const parent = feedChangeFromEvent(
      {
        type: "message",
        channel: "G1",
        channel_type: "mpim",
        user: "U1",
        text: "x",
        ts: "4.0",
        thread_ts: "4.0",
      },
      SELF,
    );
    assert.equal(parent?._tag === "upsert" && parent.message.kind, "group_dm");
    assert.equal(parent?._tag === "upsert" && parent.message.threadTs, null);
  });

  it("skips the user's own messages and membership notices", () => {
    assert.isNull(
      feedChangeFromEvent(
        {
          type: "message",
          channel: "C1",
          channel_type: "channel",
          user: SELF,
          text: "me",
          ts: "1.0",
        },
        SELF,
      ),
    );
    assert.isNull(
      feedChangeFromEvent(
        {
          type: "message",
          subtype: "channel_join",
          channel: "C1",
          channel_type: "channel",
          user: "U1",
          text: "joined",
          ts: "1.0",
        },
        SELF,
      ),
    );
  });

  it("turns edits into upserts and deletions into removals", () => {
    const edited = feedChangeFromEvent(
      {
        type: "message",
        subtype: "message_changed",
        channel: "C1",
        channel_type: "channel",
        message: { user: "U1", text: "fixed", ts: "5.0" },
      },
      SELF,
    );
    assert.equal(edited?._tag === "upsert" && edited.message.text, "fixed");

    assert.deepEqual(
      feedChangeFromEvent(
        { type: "message", subtype: "message_deleted", channel: "C1", deleted_ts: "5.0" },
        SELF,
      ),
      { _tag: "remove", channelId: "C1", ts: "5.0" },
    );
  });
});

describe("rawFromSearchMatch", () => {
  it("reads the thread from the permalink and the kind from the channel flags", () => {
    const raw = rawFromSearchMatch(
      {
        channel: { id: "D9", is_im: true },
        user: "U1",
        text: "hey",
        ts: "7.000200",
        permalink: "https://team.slack.com/archives/D9/p7000200?thread_ts=6.000100&cid=D9",
      },
      SELF,
    );
    assert.equal(raw?.kind, "dm");
    assert.equal(raw?.threadTs, "6.000100");
    assert.isNull(
      rawFromSearchMatch({ channel: { id: "C1" }, user: SELF, text: "x", ts: "1.0" }, SELF),
    );
  });
});

describe("slackMrkdwnToMarkdown", () => {
  const names: Record<string, string> = { U1: "Ana" };
  const convert = (text: string) => slackMrkdwnToMarkdown(text, (id) => names[id]);

  it("resolves mentions, channels, links and entities", () => {
    assert.equal(
      convert("<@U1> see <#C1|general> and <https://x.dev|the docs> &amp; <!here>"),
      "@Ana see #general and [the docs](https://x.dev) & @here",
    );
    assert.equal(convert("<@U2>"), "@U2");
    assert.equal(convert("<https://x.dev>"), "https://x.dev");
  });

  it("converts bold and strike but leaves code alone", () => {
    assert.equal(convert("*ship* it ~now~"), "**ship** it ~~now~~");
    assert.equal(convert("`*not bold*` and ```<@U1>```"), "`*not bold*` and ```<@U1>```");
    assert.equal(convert("&gt; quoted"), "> quoted");
  });

  it("lists mentioned users once", () => {
    assert.deepEqual(mentionedUserIds("<@U1> <@U2|bo> <@U1>"), ["U1", "U2"]);
  });
});

describe("feed window", () => {
  it("drops messages older than the window and sorts newest first", () => {
    const now = 1_700_000_000_000;
    const recent = message({ ts: String((now - 1000) / 1000) });
    const older = message({ ts: String((now - 60_000) / 1000) });
    const expired = message({ ts: String((now - SLACK_FEED_WINDOW_MS - 1000) / 1000) });
    assert.deepEqual(windowFeed([older, expired, recent], now, 10), [recent, older]);
    assert.deepEqual(windowFeed([older, recent], now, 1), [recent]);
  });
});

describe("reply target", () => {
  it("threads under channel messages, stays in threads, and answers DMs in place", () => {
    assert.equal(slackReplyThreadTs(message({ kind: "channel", ts: "1.0" })), "1.0");
    assert.equal(slackReplyThreadTs(message({ kind: "dm", ts: "1.0", threadTs: "0.5" })), "0.5");
    assert.isNull(slackReplyThreadTs(message({ kind: "dm", ts: "1.0" })));
    assert.isNull(slackReplyThreadTs(message({ kind: "group_dm", ts: "1.0" })));
  });
});

describe("names and links", () => {
  it("names group DMs without the user and builds thread permalinks", () => {
    assert.equal(groupDmName("mpdm-ana--me--bo-1", "me"), "ana, bo");
    assert.equal(
      buildPermalink("https://team.slack.com/", {
        channelId: "C1",
        kind: "channel",
        ts: "2.000300",
        threadTs: "1.000100",
        userId: "U1",
        botName: null,
        text: "x",
        permalink: null,
      }),
      "https://team.slack.com/archives/C1/p2000300?thread_ts=1.000100&cid=C1",
    );
  });
});
