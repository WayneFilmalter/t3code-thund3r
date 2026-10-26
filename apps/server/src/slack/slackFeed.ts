/**
 * Pure Slack feed logic: turning Socket Mode events and `search.messages`
 * hits into feed changes, converting Slack mrkdwn to markdown, and keeping
 * the feed to its window. The service supplies names and does the I/O.
 *
 * @module slack/slackFeed
 */
import {
  SLACK_FEED_WINDOW_DAYS,
  type SlackConversationKind,
  type SlackFeedMessage,
} from "@t3tools/contracts";

export const SLACK_FEED_WINDOW_MS = SLACK_FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** A message before names are resolved. */
export interface SlackRawMessage {
  readonly channelId: string;
  /** Null when only a search hit's flags or a later lookup can tell. */
  readonly kind: SlackConversationKind | null;
  readonly ts: string;
  readonly threadTs: string | null;
  readonly userId: string | null;
  /** A bot's display name, for messages without a user. */
  readonly botName: string | null;
  readonly text: string;
  readonly permalink: string | null;
}

export type SlackFeedChange =
  | { readonly _tag: "upsert"; readonly message: SlackRawMessage }
  | { readonly _tag: "remove"; readonly channelId: string; readonly ts: string };

/** Subtypes that are someone saying something; joins, topic changes and the like are not. */
const CONTENT_SUBTYPES = new Set([
  undefined,
  "bot_message",
  "thread_broadcast",
  "file_share",
  "me_message",
]);

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const feedKey = (channelId: string, ts: string) => `${channelId}:${ts}`;

export const slackTsToMs = (ts: string) => Math.round(Number.parseFloat(ts) * 1000);

export function kindFromChannelType(channelType: unknown): SlackConversationKind | null {
  switch (channelType) {
    case "channel":
    case "group":
      return "channel";
    case "im":
      return "dm";
    case "mpim":
      return "group_dm";
    default:
      return null;
  }
}

/** File-only messages carry no text; name the files so the item is not blank. */
function messageText(message: Json): string {
  const text = typeof message.text === "string" ? message.text : "";
  if (text.trim().length > 0) return text;
  const files = Array.isArray(message.files) ? message.files.filter(isRecord) : [];
  const names = files
    .map((file) => str(file.name) ?? str(file.title))
    .filter((name) => name !== null);
  return names.length > 0 ? `📎 ${names.join(", ")}` : "";
}

function rawFromMessage(
  message: Json,
  channelId: string,
  kind: SlackConversationKind | null,
): SlackRawMessage | null {
  const ts = str(message.ts);
  if (ts === null) return null;
  const threadTs = str(message.thread_ts);
  const botProfile = isRecord(message.bot_profile) ? message.bot_profile : null;
  return {
    channelId,
    kind,
    ts,
    // A thread's parent carries its own ts as thread_ts; it is not inside the thread.
    threadTs: threadTs === ts ? null : threadTs,
    userId: str(message.user),
    botName: str(message.username) ?? (botProfile ? str(botProfile.name) : null),
    text: messageText(message),
    permalink: str(message.permalink),
  };
}

/**
 * The feed change a Socket Mode `message` event makes, or null when it adds
 * nothing to read: the user's own messages, membership notices, hidden
 * bookkeeping events.
 */
export function feedChangeFromEvent(event: unknown, selfUserId: string): SlackFeedChange | null {
  if (!isRecord(event) || event.type !== "message") return null;
  const channelId = str(event.channel);
  if (channelId === null) return null;
  const kind = kindFromChannelType(event.channel_type);
  const subtype = str(event.subtype) ?? undefined;

  if (subtype === "message_deleted") {
    const ts = str(event.deleted_ts);
    return ts === null ? null : { _tag: "remove", channelId, ts };
  }
  if (subtype === "message_changed") {
    const message = isRecord(event.message) ? event.message : null;
    // Unfurls also arrive as edits; they change nothing a reader sees here.
    if (message === null || message.user === selfUserId) return null;
    if (str(message.subtype) === "tombstone") {
      const ts = str(message.ts);
      return ts === null ? null : { _tag: "remove", channelId, ts };
    }
    const raw = rawFromMessage(message, channelId, kind);
    // Apps like Linear edit attachment-only posts; with no text there is nothing to show.
    return raw === null || raw.text.length === 0 ? null : { _tag: "upsert", message: raw };
  }
  if (!CONTENT_SUBTYPES.has(subtype) || event.hidden === true) return null;
  if (event.user === selfUserId) return null;
  const raw = rawFromMessage(event, channelId, kind);
  return raw === null || raw.text.length === 0 ? null : { _tag: "upsert", message: raw };
}

/** A `search.messages` hit as a raw message, or null for the user's own or an unreadable one. */
export function rawFromSearchMatch(match: unknown, selfUserId: string): SlackRawMessage | null {
  if (!isRecord(match) || !isRecord(match.channel)) return null;
  if (match.user === selfUserId) return null;
  const channel = match.channel;
  const channelId = str(channel.id);
  if (channelId === null) return null;
  const kind: SlackConversationKind =
    channel.is_im === true ? "dm" : channel.is_mpim === true ? "group_dm" : "channel";
  const raw = rawFromMessage(match, channelId, kind);
  if (raw === null || raw.text.length === 0) return null;
  // Search hits carry no thread_ts; a reply's permalink names its thread.
  const threadTs = raw.permalink === null ? null : threadTsFromPermalink(raw.permalink);
  return { ...raw, threadTs: threadTs === raw.ts ? null : threadTs };
}

export function threadTsFromPermalink(permalink: string): string | null {
  try {
    return new URL(permalink).searchParams.get("thread_ts");
  } catch {
    return null;
  }
}

/** Slack's permalink shape, for live messages that arrive without one. */
export function buildPermalink(teamUrl: string, message: SlackRawMessage): string {
  const base = teamUrl.endsWith("/") ? teamUrl : `${teamUrl}/`;
  const link = `${base}archives/${message.channelId}/p${message.ts.replace(".", "")}`;
  return message.threadTs === null
    ? link
    : `${link}?thread_ts=${message.threadTs}&cid=${message.channelId}`;
}

/** `mpdm-ana--ben--cara-1` → `ana, ben, cara`, leaving out the user. */
export function groupDmName(mpdmName: string, selfHandle: string | null): string {
  const handles = mpdmName
    .replace(/^mpdm-/, "")
    .replace(/-\d+$/, "")
    .split("--")
    .filter((handle) => handle.length > 0 && handle !== selfHandle);
  return handles.length > 0 ? handles.join(", ") : mpdmName;
}

/** Newest first, inside the window, at most `limit`. */
export function windowFeed(
  messages: Iterable<SlackFeedMessage>,
  nowMs: number,
  limit: number,
): SlackFeedMessage[] {
  const oldest = nowMs - SLACK_FEED_WINDOW_MS;
  return [...messages]
    .filter((message) => slackTsToMs(message.ts) >= oldest)
    .sort((a, b) => slackTsToMs(b.ts) - slackTsToMs(a.ts))
    .slice(0, limit);
}

export const isInsideWindow = (ts: string, nowMs: number) =>
  slackTsToMs(ts) >= nowMs - SLACK_FEED_WINDOW_MS;

/** User ids in `<@U…>` mentions, so the service can look their names up before converting. */
export function mentionedUserIds(text: string): string[] {
  return [...new Set([...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!))];
}

const decodeEntities = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Bold and strike differ from markdown; italics, code and quotes already match. */
const convertEmphasis = (text: string) =>
  text
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,!?:;)])/gm, "$1**$2**")
    .replace(/(^|[\s(])~(?=\S)([^~\n]*?\S)~(?=$|[\s.,!?:;)])/gm, "$1~~$2~~");

/**
 * Slack mrkdwn → markdown. Mentions become `@name`, channel links `#name`,
 * `<url|label>` a markdown link. Code spans and blocks are left as written.
 */
export function slackMrkdwnToMarkdown(
  text: string,
  userName: (userId: string) => string | undefined,
): string {
  const replaceTokens = (segment: string) =>
    segment.replace(/<([^<>\n]+)>/g, (_match, inner: string) => {
      const [target, label] = splitToken(inner);
      if (target.startsWith("@")) {
        const id = target.slice(1);
        return `@${userName(id) ?? label ?? id}`;
      }
      if (target.startsWith("#")) return `#${label ?? target.slice(1)}`;
      if (target.startsWith("!")) {
        const command = target.slice(1);
        if (command === "here" || command === "channel" || command === "everyone") {
          return `@${command}`;
        }
        // Dates and user groups carry a readable fallback label.
        return label ?? "";
      }
      const url = decodeEntities(target);
      if (label === undefined) return url.startsWith("mailto:") ? url.slice(7) : url;
      return url.startsWith("mailto:") ? label : `[${decodeEntities(label)}](${url})`;
    });

  // Odd segments are code: ``` blocks or `spans`, kept verbatim apart from entities.
  return text
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((segment, index) =>
      index % 2 === 1
        ? decodeEntities(segment)
        : decodeEntities(convertEmphasis(replaceTokens(segment))),
    )
    .join("");
}

function splitToken(inner: string): [string, string | undefined] {
  const bar = inner.indexOf("|");
  return bar === -1 ? [inner, undefined] : [inner.slice(0, bar), inner.slice(bar + 1)];
}

/** What the user typed, escaped the way chat.postMessage expects plain text. */
export const escapeSlackText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
