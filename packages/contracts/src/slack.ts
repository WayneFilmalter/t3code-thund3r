import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * The Slack feed shown in the desktop Control window: recent messages from
 * every conversation the user is in, kept live over Slack Socket Mode. The
 * server owns the Slack connection and sends display-ready messages, so
 * clients only render and reply.
 */
export const SLACK_FEED_WINDOW_DAYS = 5;

export const SlackConversationKind = Schema.Literals(["channel", "dm", "group_dm"]);
export type SlackConversationKind = typeof SlackConversationKind.Type;

export const SlackFeedMessage = Schema.Struct({
  channelId: Schema.String,
  /** `#name` for channels; the other person's name (or names) for DMs. */
  channelName: Schema.String,
  kind: SlackConversationKind,
  /** True when the message was posted inside a thread rather than at the top level. */
  isThreadReply: Schema.Boolean,
  ts: Schema.String,
  /** The thread the message belongs to, or null for a top-level message. */
  threadTs: Schema.NullOr(Schema.String),
  senderName: Schema.String,
  /** Markdown, with Slack mentions, links and entities already resolved. */
  text: Schema.String,
  permalink: Schema.NullOr(Schema.String),
});
export type SlackFeedMessage = typeof SlackFeedMessage.Type;

export const SlackConnectionState = Schema.Literals([
  "unconfigured",
  "connecting",
  "live",
  "error",
]);
export type SlackConnectionState = typeof SlackConnectionState.Type;

export const SlackConnectionStatus = Schema.Struct({
  state: SlackConnectionState,
  /** Why the feed is in `error`, or null. */
  detail: Schema.NullOr(Schema.String),
  selfName: Schema.NullOr(Schema.String),
  teamName: Schema.NullOr(Schema.String),
  /** When the last full fetch finished. */
  fetchedAt: Schema.NullOr(IsoDateTime),
});
export type SlackConnectionStatus = typeof SlackConnectionStatus.Type;

/**
 * The live feed: a full snapshot on subscribe and after every refetch, then
 * single-message deltas so a new message costs one message on the wire.
 */
export const SlackFeedEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    status: SlackConnectionStatus,
    /** Newest first. */
    messages: Schema.Array(SlackFeedMessage),
  }),
  Schema.TaggedStruct("upsert", { message: SlackFeedMessage }),
  Schema.TaggedStruct("remove", { channelId: Schema.String, ts: Schema.String }),
  Schema.TaggedStruct("status", { status: SlackConnectionStatus }),
]);
export type SlackFeedEvent = typeof SlackFeedEvent.Type;

export const SlackFeedSubscribeInput = Schema.Struct({});
export type SlackFeedSubscribeInput = typeof SlackFeedSubscribeInput.Type;

export const SlackRefetchInput = Schema.Struct({});
export type SlackRefetchInput = typeof SlackRefetchInput.Type;

export const SlackRefetchResult = Schema.Struct({});
export type SlackRefetchResult = typeof SlackRefetchResult.Type;

/** Slack rejects messages over 40,000 characters. */
export const SLACK_MESSAGE_MAX_LENGTH = 40_000;

export const SlackReplyInput = Schema.Struct({
  channelId: TrimmedNonEmptyString,
  /** Post into this thread; null posts at the top level of the conversation. */
  threadTs: Schema.NullOr(TrimmedNonEmptyString),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(SLACK_MESSAGE_MAX_LENGTH)),
});
export type SlackReplyInput = typeof SlackReplyInput.Type;

export const SlackReplyResult = Schema.Struct({ ts: Schema.String });
export type SlackReplyResult = typeof SlackReplyResult.Type;

export class SlackError extends Schema.TaggedError<SlackError>()("SlackError", {
  kind: Schema.Literals(["not-configured", "unreachable", "rejected", "invalid-response"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * Where a reply to `message` lands: its thread when it is already in one, a
 * new thread under it in a channel (as Slack's own Reply does), and the
 * conversation itself for a top-level DM.
 */
export function slackReplyThreadTs(
  message: Pick<SlackFeedMessage, "kind" | "ts" | "threadTs">,
): string | null {
  if (message.threadTs !== null) return message.threadTs;
  return message.kind === "channel" ? message.ts : null;
}
