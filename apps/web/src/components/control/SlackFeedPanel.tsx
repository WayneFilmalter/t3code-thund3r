import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  LinearError,
  type LinearRecentComment,
  type SlackFeedMessage,
  slackReplyThreadTs,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  ArrowLeftIcon,
  BellOffIcon,
  ExternalLinkIcon,
  ListFilterIcon,
  MoreHorizontalIcon,
  ReplyIcon,
  SendIcon,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel, formatShortTimestamp } from "~/timestampFormat";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import { SlackChannelToggles } from "./SlackChannelToggles";
import { useEscapeBack } from "./useEscapeBack";
import { useSlackMutes } from "./useSlackMutes";
import {
  feedItems,
  slackMessageContext,
  slackMessagePlace,
  slackPreviewText,
  slackTsToIso,
} from "./slackFeed.logic";

const isLinearError = Schema.is(LinearError);
const NO_MESSAGES: ReadonlyArray<SlackFeedMessage> = [];
const NO_COMMENTS: ReadonlyArray<LinearRecentComment> = [];

/** One request per refresh; Linear's hourly budget for an API key is far above this. */
const LINEAR_REFRESH_MS = 2 * 60_000;

/**
 * Each source has its own colour, picked from hues nothing else in the
 * Control window uses. The border and the wash are different hues on purpose.
 */
const FEED_TONES = {
  slack: {
    label: "Slack",
    card: "border-fuchsia-500/70 bg-rose-500/[0.08] dark:border-fuchsia-400/60 dark:bg-rose-400/[0.09]",
    strip: "bg-fuchsia-500 dark:bg-fuchsia-400",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
  },
  linear: {
    label: "Linear",
    card: "border-cyan-500/70 bg-indigo-500/[0.08] dark:border-cyan-400/60 dark:bg-indigo-400/[0.10]",
    strip: "bg-cyan-500 dark:bg-cyan-400",
    text: "text-cyan-600 dark:text-cyan-400",
  },
} as const;

type FeedSource = keyof typeof FEED_TONES;

/**
 * Control window panel 2: the last few days of Slack and of Linear comments,
 * newest first. Items open in place; Reply answers where Slack's own Reply
 * would, or comments on the Linear ticket.
 */
export function SlackFeedPanel() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return <PanelMessage>No local server.</PanelMessage>;
  return <SlackFeed environmentId={environmentId} />;
}

function PanelMessage({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SlackFeed({ environmentId }: { environmentId: EnvironmentId }) {
  const feed = useEnvironmentQuery(serverEnvironment.slackFeed({ environmentId, input: null }));
  const linear = useEnvironmentQuery(
    linearEnvironment.recentComments({ environmentId, input: {} }),
  );
  const canReply = useAtomValue(serverEnvironment.slackReply.permissionAtom(environmentId));
  const canComment = useAtomValue(linearEnvironment.createComment.permissionAtom(environmentId));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [replyKey, setReplyKey] = useState<string | null>(null);
  const { mute } = useSlackMutes(environmentId);
  // Re-renders the relative times once a minute.
  useNowMinute();

  const refreshLinear = linear.refresh;
  useEffect(() => {
    const interval = window.setInterval(refreshLinear, LINEAR_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refreshLinear]);

  const messages = feed.data?.messages ?? NO_MESSAGES;
  const comments = linear.data?.comments ?? NO_COMMENTS;
  const status = feed.data?.status ?? null;
  const items = useMemo(() => feedItems(messages, comments), [messages, comments]);
  // A deleted or aged-out item drops back to the list instead of leaving a stale view.
  const open = openKey === null ? null : (items.find((item) => item.key === openKey) ?? null);

  if (open?.source === "slack") {
    const message = open.message;
    return (
      <SlackMessageView
        environmentId={environmentId}
        message={message}
        canReply={canReply}
        onBack={() => setOpenKey(null)}
        onMute={() => mute(message.channelId, message.channelName)}
      />
    );
  }
  if (open?.source === "linear") {
    return (
      <LinearCommentView
        environmentId={environmentId}
        comment={open.comment}
        canReply={canComment}
        onBack={() => setOpenKey(null)}
        onSent={refreshLinear}
      />
    );
  }

  // Without a Linear API key the feed is simply Slack's.
  const linearUnconfigured =
    isLinearError(linear.failure) && linear.failure.kind === "not-configured";
  const linearProblem = linearUnconfigured ? null : linear.error;
  const slackProblem =
    feed.error ?? (status?.state === "error" ? (status.detail ?? "Slack is unreachable.") : null);
  const notice =
    items.length > 0
      ? null
      : status === null || status.state === "connecting"
        ? "Connecting to Slack…"
        : (slackProblem ??
          linearProblem ??
          (linear.isPending && linear.data === null
            ? "Reading Linear…"
            : status.state === "unconfigured"
              ? linearUnconfigured
                ? "Connect Slack in the Control tab, or add a Linear API key in Settings → Integrations."
                : "Connect Slack in the Control tab."
              : "Nothing in the last 5 days."));
  const problem = items.length > 0 ? (slackProblem ?? linearProblem) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          <span className={FEED_TONES.slack.text}>Slack</span>
          {" · "}
          <span className={FEED_TONES.linear.text}>Linear</span>
          {status?.teamName ? ` · ${status.teamName}` : ""}
        </span>
        {problem !== null ? (
          <span className="min-w-0 truncate text-xs text-destructive">{problem}</span>
        ) : null}
        {status !== null && status.state !== "unconfigured" ? (
          <Popover>
            <PopoverTrigger render={<Button type="button" size="xs" variant="ghost-muted" />}>
              <ListFilterIcon />
              Channels
            </PopoverTrigger>
            <PopoverPopup align="end">
              <div className="flex w-64 flex-col gap-2">
                <PopoverTitle>Slack channels in the feed</PopoverTitle>
                <div className="max-h-80 overflow-y-auto">
                  <SlackChannelToggles environmentId={environmentId} messages={messages} />
                </div>
              </div>
            </PopoverPopup>
          </Popover>
        ) : null}
      </WorkflowsSubheader>
      {notice !== null ? (
        <PanelMessage>{notice}</PanelMessage>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {items.map((item) => {
            const replying = replyKey === item.key;
            const toggleReply = () => setReplyKey(replying ? null : item.key);
            const doneReplying = () => setReplyKey(null);
            if (item.source === "linear") {
              return (
                <LinearCommentItem
                  key={item.key}
                  environmentId={environmentId}
                  comment={item.comment}
                  canReply={canComment}
                  replying={replying}
                  onOpen={() => setOpenKey(item.key)}
                  onReply={toggleReply}
                  onReplyDone={doneReplying}
                  onSent={() => {
                    doneReplying();
                    refreshLinear();
                  }}
                />
              );
            }
            const { message } = item;
            return (
              <SlackMessageItem
                key={item.key}
                environmentId={environmentId}
                message={message}
                canReply={canReply}
                replying={replying}
                onOpen={() => setOpenKey(item.key)}
                onReply={toggleReply}
                onReplyDone={doneReplying}
                onMute={() => mute(message.channelId, message.channelName)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A list card in its source's colours, with the source's strip down the left edge. */
function FeedCard(props: { source: FeedSource; children: ReactNode }) {
  const tone = FEED_TONES[props.source];
  return (
    <li className={cn("relative overflow-hidden rounded-lg border", tone.card)}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", tone.strip)} />
      {props.children}
    </li>
  );
}

/** The detail view's header, underlined in its source's colour. */
function FeedViewHeader(props: { source: FeedSource; onBack: () => void; children: ReactNode }) {
  return (
    <>
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        {props.children}
      </WorkflowsSubheader>
      <span aria-hidden className={cn("h-0.5 shrink-0", FEED_TONES[props.source].strip)} />
    </>
  );
}

function FeedItemHeader(props: {
  source: FeedSource;
  author: string;
  place: string | null;
  at: string;
  context: string | null;
}) {
  const tone = FEED_TONES[props.source];
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn("shrink-0 text-2xs font-semibold uppercase tracking-wide", tone.text)}>
          {tone.label}
        </span>
        <span className="truncate text-sm font-medium text-foreground">{props.author}</span>
        {props.place !== null ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{props.place}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {formatRelativeTimeLabel(props.at)}
        </span>
      </span>
      {props.context ? (
        <span className="truncate text-2xs text-muted-foreground">{props.context}</span>
      ) : null}
    </span>
  );
}

function FeedItemBody(props: {
  source: FeedSource;
  author: string;
  place: string | null;
  at: string;
  context: string | null;
  text: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex w-full cursor-pointer flex-col gap-1 pt-2 pr-3 pl-4 text-left"
    >
      <FeedItemHeader
        source={props.source}
        author={props.author}
        place={props.place}
        at={props.at}
        context={props.context}
      />
      <span className="line-clamp-3 text-xs whitespace-pre-wrap break-words text-foreground/85">
        {slackPreviewText(props.text)}
      </span>
    </button>
  );
}

function ReplyButton(props: { disabled: boolean; replying: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost-muted"
      disabled={props.disabled}
      aria-expanded={props.replying}
      onClick={props.onClick}
    >
      <ReplyIcon />
      Reply
    </Button>
  );
}

function SlackMessageItem(props: {
  environmentId: EnvironmentId;
  message: SlackFeedMessage;
  canReply: boolean;
  replying: boolean;
  onOpen: () => void;
  onReply: () => void;
  onReplyDone: () => void;
  onMute: () => void;
}) {
  const { message } = props;
  return (
    <FeedCard source="slack">
      <FeedItemBody
        source="slack"
        author={message.senderName}
        place={slackMessagePlace(message)}
        at={slackTsToIso(message.ts)}
        context={slackMessageContext(message)}
        text={message.text}
        onOpen={props.onOpen}
      />
      <div className="flex justify-end gap-1 px-1.5 pb-1">
        <SlackMessageMenu message={message} onMute={props.onMute} />
        <ReplyButton disabled={!props.canReply} replying={props.replying} onClick={props.onReply} />
      </div>
      {props.replying ? (
        <div className="border-t border-border/60 p-2 pl-4">
          <SlackReplyBox
            environmentId={props.environmentId}
            message={message}
            autoFocus
            onSent={props.onReplyDone}
            onCancel={props.onReplyDone}
          />
        </div>
      ) : null}
    </FeedCard>
  );
}

function LinearCommentItem(props: {
  environmentId: EnvironmentId;
  comment: LinearRecentComment;
  canReply: boolean;
  replying: boolean;
  onOpen: () => void;
  onReply: () => void;
  onReplyDone: () => void;
  onSent: () => void;
}) {
  const { comment } = props;
  return (
    <FeedCard source="linear">
      <FeedItemBody
        source="linear"
        author={comment.authorName}
        place={comment.issueIdentifier}
        at={comment.createdAt}
        context={comment.issueTitle}
        text={comment.body}
        onOpen={props.onOpen}
      />
      <div className="flex justify-end gap-1 px-1.5 pb-1">
        <ReplyButton disabled={!props.canReply} replying={props.replying} onClick={props.onReply} />
      </div>
      {props.replying ? (
        <div className="border-t border-border/60 p-2 pl-4">
          <LinearReplyBox
            environmentId={props.environmentId}
            comment={comment}
            autoFocus
            onSent={props.onSent}
            onCancel={props.onReplyDone}
          />
        </div>
      ) : null}
    </FeedCard>
  );
}

function SlackMessageView(props: {
  environmentId: EnvironmentId;
  message: SlackFeedMessage;
  canReply: boolean;
  onBack: () => void;
  onMute: () => void;
}) {
  const { message } = props;
  const { timestampFormat } = useClientSettings();
  const place = slackMessagePlace(message);
  const context = slackMessageContext(message);
  const escapeBack = useEscapeBack(props.onBack);
  return (
    <div {...escapeBack} className="flex h-full min-h-0 flex-col outline-none">
      <FeedViewHeader source="slack" onBack={props.onBack}>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {message.senderName}
          {place !== null ? (
            <span className="font-normal text-muted-foreground"> · {place}</span>
          ) : null}
        </span>
        {message.permalink !== null ? (
          <Button
            size="xs"
            variant="ghost-muted"
            render={<a href={message.permalink} target="_blank" rel="noreferrer noopener" />}
          >
            Open in Slack
            <ExternalLinkIcon />
          </Button>
        ) : null}
        <SlackMessageMenu message={message} onMute={props.onMute} />
      </FeedViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-2xs text-muted-foreground">
          {[context, formatShortTimestamp(slackTsToIso(message.ts), timestampFormat)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <ChatMarkdown text={message.text} cwd={undefined} lineBreaks />
      </div>
      {props.canReply ? (
        <div className="shrink-0 border-t border-border/60 p-2">
          <SlackReplyBox environmentId={props.environmentId} message={message} />
        </div>
      ) : null}
    </div>
  );
}

function LinearCommentView(props: {
  environmentId: EnvironmentId;
  comment: LinearRecentComment;
  canReply: boolean;
  onBack: () => void;
  onSent: () => void;
}) {
  const { comment } = props;
  const { timestampFormat } = useClientSettings();
  const escapeBack = useEscapeBack(props.onBack);
  return (
    <div {...escapeBack} className="flex h-full min-h-0 flex-col outline-none">
      <FeedViewHeader source="linear" onBack={props.onBack}>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {comment.authorName}
          <span className="font-normal text-muted-foreground"> · {comment.issueIdentifier}</span>
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          render={<a href={comment.url} target="_blank" rel="noreferrer noopener" />}
        >
          Open in Linear
          <ExternalLinkIcon />
        </Button>
      </FeedViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="text-sm font-medium text-foreground">{comment.issueTitle}</p>
        <p className="mb-2 text-2xs text-muted-foreground">
          {formatShortTimestamp(comment.createdAt, timestampFormat)}
        </p>
        <ChatMarkdown text={comment.body} cwd={undefined} />
      </div>
      {props.canReply ? (
        <div className="shrink-0 border-t border-border/60 p-2">
          <LinearReplyBox
            environmentId={props.environmentId}
            comment={comment}
            onSent={props.onSent}
          />
        </div>
      ) : null}
    </div>
  );
}

function SlackMessageMenu(props: { message: SlackFeedMessage; onMute: () => void }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button type="button" size="icon-xs" variant="ghost-muted" aria-label="Message actions" />
        }
      >
        <MoreHorizontalIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={props.onMute}>
          <BellOffIcon />
          Mute {props.message.channelName}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function SlackReplyBox(props: {
  environmentId: EnvironmentId;
  message: SlackFeedMessage;
  autoFocus?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const reply = useAtomCommand(serverEnvironment.slackReply, { label: "reply on Slack" });
  const threadTs = slackReplyThreadTs(props.message);
  const placeholder =
    threadTs !== null
      ? "Reply in thread…"
      : props.message.kind === "dm"
        ? `Message ${props.message.senderName}…`
        : `Message ${props.message.channelName}…`;
  return (
    <FeedReplyBox
      placeholder={placeholder}
      autoFocus={props.autoFocus}
      onCancel={props.onCancel}
      onSend={async (text) => {
        const result = await reply({
          environmentId: props.environmentId,
          input: { channelId: props.message.channelId, threadTs, text },
        });
        if (result._tag !== "Success") return false;
        props.onSent?.();
        return true;
      }}
    />
  );
}

/** Posts a comment on the ticket, as the Priorities panel does. */
function LinearReplyBox(props: {
  environmentId: EnvironmentId;
  comment: LinearRecentComment;
  autoFocus?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const createComment = useAtomCommand(linearEnvironment.createComment);
  const { comment } = props;
  return (
    <FeedReplyBox
      placeholder={`Comment on ${comment.issueIdentifier}…`}
      autoFocus={props.autoFocus}
      onCancel={props.onCancel}
      onSend={async (body) => {
        const result = await createComment({
          environmentId: props.environmentId,
          input: { issueId: comment.issueId, body },
        });
        if (result._tag !== "Success") return false;
        toastManager.add({ type: "success", title: `Commented on ${comment.issueIdentifier}` });
        props.onSent?.();
        return true;
      }}
    />
  );
}

/**
 * Enter sends, Shift+Enter adds a line, Escape closes an inline box. The
 * draft clears only when `onSend` reports success.
 */
function FeedReplyBox(props: {
  placeholder: string;
  autoFocus?: boolean | undefined;
  onSend: (text: string) => Promise<boolean>;
  onCancel?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      if (await props.onSend(text)) setDraft("");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && props.onCancel) {
      event.preventDefault();
      props.onCancel();
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Textarea
          size="sm"
          rows={2}
          placeholder={props.placeholder}
          value={draft}
          disabled={sending}
          autoFocus={props.autoFocus}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <Button
        type="button"
        size="icon-sm"
        aria-label="Send reply"
        disabled={sending || draft.trim().length === 0}
        onClick={() => void send()}
      >
        <SendIcon />
      </Button>
    </div>
  );
}
