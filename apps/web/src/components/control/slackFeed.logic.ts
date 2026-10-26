import type { SlackFeedMessage } from "@t3tools/contracts";

export const slackMessageKey = (message: Pick<SlackFeedMessage, "channelId" | "ts">) =>
  `${message.channelId}:${message.ts}`;

export const slackTsToIso = (ts: string) => new Date(Number.parseFloat(ts) * 1000).toISOString();

/** The small line under the sender: what kind of conversation, and whether it is in a thread. */
export function slackMessageContext(message: SlackFeedMessage): string {
  const parts: string[] = [];
  if (message.kind === "dm") parts.push("Direct message");
  if (message.kind === "group_dm") parts.push("Group DM");
  if (message.isThreadReply) parts.push("Thread reply");
  return parts.join(" · ");
}

/** Beside the sender: the channel, or the other people in a group DM. A DM's is the sender. */
export const slackMessagePlace = (message: SlackFeedMessage) =>
  message.kind === "dm" ? null : message.channelName;

/** List bodies are plain text; markdown links and emphasis read as their words. */
export const slackPreviewText = (markdown: string) =>
  markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
