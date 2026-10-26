import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type SlackFeedMessage, slackReplyThreadTs } from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon, ReplyIcon, SendIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel, formatShortTimestamp } from "~/timestampFormat";

import { WorkflowsSubheader } from "../workflows/WorkflowsSubheader";
import {
  slackMessageContext,
  slackMessageKey,
  slackMessagePlace,
  slackPreviewText,
  slackTsToIso,
} from "./slackFeed.logic";

/**
 * Control window panel 2: the last few days of Slack, newest first. Items
 * open in place, and Reply answers where Slack's own Reply would.
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
  const canReply = useAtomValue(serverEnvironment.slackReply.permissionAtom(environmentId));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [replyKey, setReplyKey] = useState<string | null>(null);
  // Re-renders the relative times once a minute.
  useNowMinute();

  const messages = feed.data?.messages ?? [];
  const status = feed.data?.status ?? null;
  // A deleted or aged-out message drops back to the list instead of leaving a stale view.
  const open =
    openKey === null ? null : (messages.find((m) => slackMessageKey(m) === openKey) ?? null);

  if (open !== null) {
    return (
      <SlackMessageView
        environmentId={environmentId}
        message={open}
        canReply={canReply}
        onBack={() => setOpenKey(null)}
      />
    );
  }

  const notice =
    feed.error !== null
      ? feed.error
      : status === null || (status.state === "connecting" && messages.length === 0)
        ? "Connecting to Slack…"
        : status.state === "unconfigured"
          ? "Connect Slack in the Control tab."
          : status.state === "error" && messages.length === 0
            ? (status.detail ?? "Slack is unreachable.")
            : messages.length === 0
              ? "No messages in the last 5 days."
              : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          Slack
          {status?.teamName ? ` · ${status.teamName}` : ""}
        </span>
        {status?.state === "error" && messages.length > 0 ? (
          <span className="min-w-0 truncate text-xs text-destructive">{status.detail}</span>
        ) : null}
      </WorkflowsSubheader>
      {notice !== null ? (
        <PanelMessage>{notice}</PanelMessage>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {messages.map((message) => {
            const key = slackMessageKey(message);
            return (
              <SlackMessageItem
                key={key}
                environmentId={environmentId}
                message={message}
                canReply={canReply}
                replying={replyKey === key}
                onOpen={() => setOpenKey(key)}
                onReply={() => setReplyKey(replyKey === key ? null : key)}
                onReplyDone={() => setReplyKey(null)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SlackMessageHeader({ message }: { message: SlackFeedMessage }) {
  const place = slackMessagePlace(message);
  const context = slackMessageContext(message);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-sm font-medium text-foreground">{message.senderName}</span>
        {place !== null ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{place}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {formatRelativeTimeLabel(slackTsToIso(message.ts))}
        </span>
      </span>
      {context ? <span className="text-2xs text-muted-foreground">{context}</span> : null}
    </span>
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
}) {
  const { message } = props;
  return (
    <li className="rounded-lg border border-border/70 bg-card">
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full cursor-pointer flex-col gap-1 px-3 pt-2 text-left"
      >
        <SlackMessageHeader message={message} />
        <span className="line-clamp-3 text-xs whitespace-pre-wrap break-words text-foreground/85">
          {slackPreviewText(message.text)}
        </span>
      </button>
      <div className="flex justify-end px-1.5 pb-1">
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={!props.canReply}
          aria-expanded={props.replying}
          onClick={props.onReply}
        >
          <ReplyIcon />
          Reply
        </Button>
      </div>
      {props.replying ? (
        <div className="border-t border-border/60 p-2">
          <SlackReplyBox
            environmentId={props.environmentId}
            message={message}
            autoFocus
            onSent={props.onReplyDone}
            onCancel={props.onReplyDone}
          />
        </div>
      ) : null}
    </li>
  );
}

function SlackMessageView(props: {
  environmentId: EnvironmentId;
  message: SlackFeedMessage;
  canReply: boolean;
  onBack: () => void;
}) {
  const { message } = props;
  const { timestampFormat } = useClientSettings();
  const place = slackMessagePlace(message);
  const context = slackMessageContext(message);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
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
      </WorkflowsSubheader>
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

/** Enter sends, Shift+Enter adds a line, Escape closes an inline box. */
function SlackReplyBox(props: {
  environmentId: EnvironmentId;
  message: SlackFeedMessage;
  autoFocus?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const reply = useAtomCommand(serverEnvironment.slackReply, { label: "reply on Slack" });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadTs = slackReplyThreadTs(props.message);
  const placeholder =
    threadTs !== null
      ? "Reply in thread…"
      : props.message.kind === "dm"
        ? `Message ${props.message.senderName}…`
        : `Message ${props.message.channelName}…`;

  const send = async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await reply({
        environmentId: props.environmentId,
        input: { channelId: props.message.channelId, threadTs, text },
      });
      if (result._tag === "Success") {
        setDraft("");
        props.onSent?.();
      }
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
          placeholder={placeholder}
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
